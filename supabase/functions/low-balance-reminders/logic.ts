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

/** Push notification text. */
export function pushText(p: PlayerBalance, recipientName: string): { title: string; body: string } {
  return {
    title: `Low balance: ${formatMoney(p.balance)}`,
    body: `Hi ${p.name}, your CourtCrew balance is ${formatMoney(p.balance)}. ` +
      `Please e-Transfer ${recipientName} to top up, then tap "I've sent it" in the app.`,
  };
}
