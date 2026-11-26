// Pure decision logic for low-balance reminders. No imports, so it runs both
// in the Deno edge function and in the app's vitest suite.

export interface ReminderSettings {
  enabled: boolean;
  threshold: number;     // remind when balance is below this ($)
  repeatDays: number;    // don't remind the same player again within this many days
  excludedNames: string[]; // fund manager, treasurer account, etc. (case-insensitive)
}

export interface PlayerBalance {
  id: string;
  name: string;
  balance: number;
  email: string | null;
  archived: boolean;
}

export interface PastReminder {
  player_id: string;
  last_sent_at: string; // ISO
}

export interface ReminderPlan {
  toRemind: PlayerBalance[]; // below threshold and due a reminder
  toReset: string[];         // player ids back above threshold: forget the old reminder
  skippedRecent: PlayerBalance[]; // below threshold but reminded recently
}

const DEFAULTS = { threshold: 10, repeatDays: 7 };

/** Read reminder settings from the settings table's key/value map. */
export function readSettings(map: Record<string, string>): ReminderSettings {
  const num = (v: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const excluded = [map.fund_manager || map.admin2 || '', map.treasurer || '']
    .map(s => s.trim())
    .filter(Boolean);
  return {
    enabled: map.low_balance_reminders === 'on',
    threshold: num(map.low_balance_threshold, DEFAULTS.threshold, 0, 1000),
    repeatDays: num(map.low_balance_repeat_days, DEFAULTS.repeatDays, 1, 60),
    excludedNames: excluded,
  };
}

export function planReminders(
  players: PlayerBalance[],
  past: PastReminder[],
  settings: ReminderSettings,
  now: Date = new Date(),
): ReminderPlan {
  const excluded = new Set(settings.excludedNames.map(n => n.toLowerCase()));
  const lastSent = new Map(past.map(p => [p.player_id, new Date(p.last_sent_at).getTime()]));
  const repeatMs = settings.repeatDays * 24 * 60 * 60 * 1000;
  const plan: ReminderPlan = { toRemind: [], toReset: [], skippedRecent: [] };

  for (const p of players) {
    if (p.archived || excluded.has(p.name.trim().toLowerCase())) continue;
    const balance = Math.round(p.balance * 100) / 100;
    if (balance >= settings.threshold) {
      if (lastSent.has(p.id)) plan.toReset.push(p.id);
      continue;
    }
    const sent = lastSent.get(p.id);
    if (sent !== undefined && now.getTime() - sent < repeatMs) {
      plan.skippedRecent.push({ ...p, balance });
    } else {
      plan.toRemind.push({ ...p, balance });
    }
  }
  plan.toRemind.sort((a, b) => a.balance - b.balance);
  return plan;
}

export function formatMoney(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

// ── Court-hours alert (admins) ───────────────────────────────────────────────

export interface CourtAlertSettings {
  enabled: boolean;
  threshold: number;  // alert when remaining court hours are below this
  repeatDays: number; // repeat while still low, at most this often
}

export function readCourtSettings(map: Record<string, string>): CourtAlertSettings {
  const num = (v: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    enabled: map.court_hours_alert === 'on',
    threshold: num(map.court_hours_threshold, 10, 0, 500),
    repeatDays: num(map.court_hours_repeat_days, 3, 1, 30),
  };
}

/**
 * Remaining court hours, the same way the Fees tab shows them: purchased minus
 * used (courts × session hours, default 2), or — when an admin set an override —
 * the override value plus hours bought since minus hours used since.
 */
export function computeRemainingHours(
  payments: { hours_purchased: number | string | null; paid_at?: string | null }[],
  sessions: { courts_count: number | null; session_hours?: number | null; created_at?: string | null }[],
  overrideRaw: string | null | undefined,
): number {
  const used = (s: { courts_count: number | null; session_hours?: number | null }) =>
    Number(s.courts_count || 0) * Number(s.session_hours ?? 2);
  const bought = (c: { hours_purchased: number | string | null }) => Number(c.hours_purchased || 0);

  if (overrideRaw) {
    try {
      const o = JSON.parse(overrideRaw);
      if (o && typeof o.value === 'number' && o.date) {
        const t = new Date(o.date).getTime();
        const usedSince = sessions
          .filter(s => s.created_at && new Date(s.created_at).getTime() > t)
          .reduce((sum, s) => sum + used(s), 0);
        const boughtSince = payments
          .filter(c => c.paid_at && new Date(c.paid_at).getTime() > t)
          .reduce((sum, c) => sum + bought(c), 0);
        return o.value + boughtSince - usedSince;
      }
    } catch { /* malformed override: fall through */ }
  }
  return payments.reduce((s, c) => s + bought(c), 0) - sessions.reduce((s, x) => s + used(x), 0);
}

export type CourtAlertDecision = 'disabled' | 'ok' | 'send' | 'recently-sent';

export function decideCourtAlert(
  remaining: number,
  settings: CourtAlertSettings,
  lastSentIso: string | null | undefined,
  now: Date = new Date(),
): CourtAlertDecision {
  if (remaining >= settings.threshold) return 'ok';
  if (!settings.enabled) return 'disabled';
  if (lastSentIso) {
    const last = new Date(lastSentIso).getTime();
    if (Number.isFinite(last) && now.getTime() - last < settings.repeatDays * 86_400_000) return 'recently-sent';
  }
  return 'send';
}

export function courtAlertText(remaining: number): { title: string; body: string } {
  const h = Math.round(remaining * 10) / 10;
  return {
    title: `Court hours low: ${h} left`,
    body: `Only ${h} court hours are left on the club's account. Book more hours with the venue and log the payment in the app.`,
  };
}

/** Push notification text. */
export function pushText(p: PlayerBalance, recipientName: string): { title: string; body: string } {
  return {
    title: `Low balance: ${formatMoney(p.balance)}`,
    body: `Hi ${p.name}, your CourtCrew balance is ${formatMoney(p.balance)}. ` +
      `Please e-Transfer ${recipientName} to top up, then tap "I've sent it" in the app.`,
  };
}
