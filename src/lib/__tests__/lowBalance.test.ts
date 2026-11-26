import { describe, it, expect } from 'vitest';
import {
  readSettings, planReminders, pushText, formatMoney, type PlayerBalance,
  readCourtSettings, computeRemainingHours, decideCourtAlert, courtAlertText,
} from '../../../supabase/functions/low-balance-reminders/logic';

describe('court-hours alert', () => {
  const on = readCourtSettings({ court_hours_alert: 'on' });
  const payments = [
    { hours_purchased: 100, paid_at: '2026-01-01' },
    { hours_purchased: '50', paid_at: '2026-06-01' },
  ];
  const sessions = [
    { courts_count: 3, session_hours: 2, created_at: '2026-02-01' }, // 6
    { courts_count: 2, session_hours: null, created_at: '2026-07-01' }, // 4 (default 2h)
  ];

  it('defaults: off, 10 hours, every 3 days', () => {
    expect(readCourtSettings({})).toEqual({ enabled: false, threshold: 10, repeatDays: 3 });
  });
  it('computes purchased minus used', () => {
    expect(computeRemainingHours(payments, sessions, '')).toBe(140);
  });
  it('honours an admin override: value + bought since − used since', () => {
    const override = JSON.stringify({ value: 20, date: '2026-05-01T00:00:00Z' });
    expect(computeRemainingHours(payments, sessions, override)).toBe(20 + 50 - 4);
  });
  it('ignores a malformed override', () => {
    expect(computeRemainingHours(payments, sessions, '{oops')).toBe(140);
  });
  it('decides when to alert', () => {
    const now = new Date('2026-11-27T18:00:00Z');
    expect(decideCourtAlert(12, on, null, now)).toBe('ok');
    expect(decideCourtAlert(5.5, readCourtSettings({}), null, now)).toBe('disabled');
    expect(decideCourtAlert(5.5, on, null, now)).toBe('send');
    expect(decideCourtAlert(5.5, on, '2026-11-26T18:00:00Z', now)).toBe('recently-sent');
    expect(decideCourtAlert(5.5, on, '2026-11-23T18:00:00Z', now)).toBe('send');
  });
  it('writes a short message', () => {
    expect(courtAlertText(5.5).title).toBe('Court hours low: 5.5 left');
  });
});

const now = new Date('2026-11-27T18:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

const p = (name: string, balance: number, extra: Partial<PlayerBalance> = {}): PlayerBalance => ({
  id: `id-${name}`, name, balance, email: `${name.toLowerCase()}@example.com`, archived: false, ...extra,
});

const base = readSettings({ low_balance_reminders: 'on', fund_manager: 'Arun', treasurer: 'Treasurer' });

describe('readSettings', () => {
  it('is off unless explicitly on, with sane defaults', () => {
    const s = readSettings({});
    expect(s.enabled).toBe(false);
    expect(s.threshold).toBe(10);
    expect(s.repeatDays).toBe(7);
  });
  it('reads and clamps values', () => {
    const s = readSettings({ low_balance_reminders: 'on', low_balance_threshold: '25', low_balance_repeat_days: '999' });
    expect(s.enabled).toBe(true);
    expect(s.threshold).toBe(25);
    expect(s.repeatDays).toBe(60);
  });
  it('excludes the fund manager (falling back to admin2) and treasurer', () => {
    expect(readSettings({ admin2: 'Arun', treasurer: 'Treasurer' }).excludedNames).toEqual(['Arun', 'Treasurer']);
  });
});

describe('planReminders', () => {
  it('reminds players below the threshold, lowest first', () => {
    const plan = planReminders([p('Ravi', 4), p('Sam', -3), p('Kim', 50)], [], base, now);
    expect(plan.toRemind.map(x => x.name)).toEqual(['Sam', 'Ravi']);
  });
  it('treats exactly the threshold as fine', () => {
    expect(planReminders([p('Ravi', 10)], [], base, now).toRemind).toHaveLength(0);
  });
  it('skips the fund manager, treasurer and archived players (case-insensitive)', () => {
    const plan = planReminders(
      [p('arun', -1900), p('Treasurer', -5), p('Old', -20, { archived: true }), p('Ravi', 2)], [], base, now);
    expect(plan.toRemind.map(x => x.name)).toEqual(['Ravi']);
  });
  it('waits out the repeat window, then reminds again', () => {
    const players = [p('Ravi', 2)];
    expect(planReminders(players, [{ player_id: 'id-Ravi', last_sent_at: daysAgo(3) }], base, now).skippedRecent)
      .toHaveLength(1);
    expect(planReminders(players, [{ player_id: 'id-Ravi', last_sent_at: daysAgo(8) }], base, now).toRemind)
      .toHaveLength(1);
  });
  it('resets players who topped up so the next drop reminds right away', () => {
    const plan = planReminders([p('Ravi', 40)], [{ player_id: 'id-Ravi', last_sent_at: daysAgo(1) }], base, now);
    expect(plan.toReset).toEqual(['id-Ravi']);
    expect(plan.toRemind).toHaveLength(0);
  });
  it('rounds balances to cents before comparing', () => {
    expect(planReminders([p('Ravi', 9.999)], [], base, now).toRemind).toHaveLength(0);
  });
});

describe('message text', () => {
  it('formats money with a minus sign before the dollar', () => {
    expect(formatMoney(-3.5)).toBe('-$3.50');
    expect(formatMoney(4)).toBe('$4.00');
  });
  it('names the player, balance and who to pay', () => {
    const t = pushText(p('Ravi', -3.5), 'Arun');
    expect(t.title).toBe('Low balance: -$3.50');
    expect(t.body).toContain('Hi Ravi');
    expect(t.body).toContain('e-Transfer Arun');
  });
});
