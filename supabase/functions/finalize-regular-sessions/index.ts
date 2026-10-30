import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Server-side auto-finalizer for regular (Saturday / Wednesday) sessions.
//
// Mirrors the client AppContext.completeSession logic EXACTLY — same waitlist
// ordering, same computeSessionCost / computeFinalizeCharges math, same
// completed_sessions fields and transaction rows — so balances are identical
// whether a session is finalized by the client or by this cron. It finalizes
// the moment the session has ended in Pacific time (no buffer), so the email
// no longer depends on a member having the app open. After finalizing it
// triggers send-session-emails so the summary goes out immediately.
//
// Idempotent: the completed_sessions (week,day) UNIQUE row is the lock — a
// session already finalized (by an earlier run, or the admin "Log past
// session" tool) is skipped.
//
// POST {} (cron)                     → finalize any ended, not-yet-finalized day.
// POST {"dryRun":true,"week","day"}  → compute WITHOUT writing (parity testing).

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SEND_SESSION_EMAILS_URL = `${SUPABASE_URL}/functions/v1/send-session-emails`;

const PACIFIC_TZ = 'America/Vancouver';
const REGULAR_DAYS = ['saturday', 'wednesday'] as const;
type Day = typeof REGULAR_DAYS[number];

// ── Pure money math (verbatim from src/lib/sessionMath.ts) ─────────────────────
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

interface CourtSplitSegment { courts: number; hours: number; }
interface CourtSplit { enabled: boolean; segments: CourtSplitSegment[]; }

function parseCourtSplit(raw?: string | null): CourtSplit | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { enabled?: unknown; segments?: unknown };
    if (!o || !Array.isArray(o.segments)) return null;
    const segments = (o.segments as { courts?: unknown; hours?: unknown }[])
      .map(s => ({ courts: Number(s.courts) || 0, hours: Number(s.hours) || 0 }))
      .filter(s => s.courts > 0 && s.hours > 0);
    return { enabled: !!o.enabled, segments };
  } catch {
    return null;
  }
}
function courtSplitCourtHours(split: CourtSplit | null): number {
  if (!split || !split.enabled || split.segments.length === 0) return 0;
  return split.segments.reduce((sum, s) => sum + s.courts * s.hours, 0);
}
function courtSplitMaxCourts(split: CourtSplit | null): number {
  if (!split || split.segments.length === 0) return 0;
  return Math.max(...split.segments.map(s => s.courts));
}
function courtSplitTotalHours(split: CourtSplit | null): number {
  if (!split || split.segments.length === 0) return 0;
  return split.segments.reduce((sum, s) => sum + s.hours, 0);
}
function computeSessionCost(input: {
  totalCostOverride?: number | null; split: CourtSplit | null;
  courtsCount: number; sessionHours: number; ratePerCourt: number;
}) {
  const { totalCostOverride, split, courtsCount, sessionHours, ratePerCourt } = input;
  const perHourPerCourt = ratePerCourt / 2;
  const splitActive = !!split?.enabled && split.segments.length > 0;
  const splitHours = courtSplitCourtHours(split);
  if (totalCostOverride != null) {
    return { totalCost: totalCostOverride, effectiveCourtsCount: courtsCount, effectiveSessionHours: sessionHours };
  }
  if (splitActive && splitHours > 0) {
    return { totalCost: splitHours * perHourPerCourt, effectiveCourtsCount: courtSplitMaxCourts(split), effectiveSessionHours: courtSplitTotalHours(split) };
  }
  return { totalCost: courtsCount * perHourPerCourt * sessionHours, effectiveCourtsCount: courtsCount, effectiveSessionHours: sessionHours };
}
function computePerPerson(totalCost: number, totalPeople: number): number {
  return totalPeople > 0 ? round3(totalCost / totalPeople) : 0;
}
interface GuestLike { name: string; brought_by?: string | null; }
function computeFinalizeCharges(input: {
  goingPlayers: string[]; guests: GuestLike[]; hoursMap: Record<string, number>; totalCost: number;
}) {
  const { goingPlayers, guests, hoursMap, totalCost } = input;
  const totalPlayerHours = goingPlayers.reduce((sum, n) => sum + (hoursMap[n] ?? 2), 0) + guests.length * 2;
  const ratePerHour = totalPlayerHours > 0 ? totalCost / totalPlayerHours : 0;
  const playerCharges = goingPlayers.map(name => ({ name, amount: round3((hoursMap[name] ?? 2) * ratePerHour) }));
  const guestCharges = guests
    .filter(g => !!g.brought_by)
    .map(g => ({ host: g.brought_by as string, guest: g.name, amount: round3(2 * ratePerHour) }));
  return { totalPlayerHours, ratePerHour, playerCharges, guestCharges };
}

// ── Waitlist (verbatim from src/lib/waitlist.ts) ──────────────────────────────
const MAX_COURTS = 4, BASE_PER_COURT = 4, EXTRA_PER_COURT = 1;
const capacityFor = (c: number) => c * (BASE_PER_COURT + EXTRA_PER_COURT);
const courtsOpenFor = (total: number) => Math.min(Math.max(0, Math.floor(total / BASE_PER_COURT)), MAX_COURTS);
interface Attendee { name: string; isGuest: boolean; broughtBy?: string; votedAt: string; }
function computeWaitlist(attendees: Attendee[]) {
  const ordered = [...attendees].sort((a, b) => {
    const ta = a.votedAt || '￿';
    const tb = b.votedAt || '￿';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const total = ordered.length;
  const courtsOpen = courtsOpenFor(total);
  const capacity = capacityFor(courtsOpen);
  const acceptedCount = Math.min(total, capacity);
  return { courtsOpen, capacity, accepted: ordered.slice(0, acceptedCount), waitlisted: ordered.slice(acceptedCount) };
}

// ── Pacific-time helpers ──────────────────────────────────────────────────────
const getPacificNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: PACIFIC_TZ }));
const pad = (n: number) => String(n).padStart(2, '0');

// The week key for the session most recently played (mirrors
// constants.getCompletedWeekKey). This is the week finalization records under.
function getCompletedWeekKey(): string {
  const now = getPacificNow();
  const dow = now.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const sat = new Date(now);
  sat.setHours(0, 0, 0, 0);
  sat.setDate(sat.getDate() + mondayOffset + 5);
  return `${sat.getFullYear()}-${pad(sat.getMonth() + 1)}-${pad(sat.getDate())}`;
}
// Wednesday is 3 days before the week-key Saturday (UTC-safe date math).
function wednesdayDate(week: string): string {
  const [y, m, d] = week.split('-').map(Number);
  const wed = new Date(Date.UTC(y, m - 1, d - 3));
  return `${wed.getUTCFullYear()}-${pad(wed.getUTCMonth() + 1)}-${pad(wed.getUTCDate())}`;
}
// DST-safe: interpret `dateStr` at h:mi as Pacific wall-clock, return UTC ms.
function pacificInstantMs(dateStr: string, h: number, mi: number): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, 0);
  const seenInPacific = new Date(new Date(asUTC).toLocaleString('en-US', { timeZone: PACIFIC_TZ }));
  const offset = asUTC - seenInPacific.getTime();
  return asUTC + offset;
}

interface DayResult { day: Day; [k: string]: unknown; }

async function processDay(day: Day, settings: Record<string, string>, opts: { dryRun?: boolean; forceWeek?: string }): Promise<DayResult> {
  const week = opts.forceWeek ?? getCompletedWeekKey();
  const sessionDate = day === 'saturday' ? week : wednesdayDate(week);

  // Guard 1: never finalize before the session has ended in Pacific (no buffer).
  const endHour = day === 'saturday' ? 9 : (Number(settings['wed_end_hour']) || 20);
  if (!opts.dryRun && Date.now() < pacificInstantMs(sessionDate, endHour, 0)) {
    return { day, skipped: 'not_ended' };
  }

  // Guard 2: never re-finalize (the completed_sessions row is the lock).
  if (!opts.dryRun) {
    const { data: existing } = await supabase
      .from('completed_sessions').select('id').eq('week', week).eq('day', day).limit(1);
    if (existing && existing.length > 0) return { day, skipped: 'already_done' };
  }

  const { data: rsvpRows } = await supabase
    .from('rsvps').select('player_name, voted_at, hours')
    .eq('week', week).eq('day', day).eq('status', 'going');
  const going = rsvpRows ?? [];
  const goingAll: string[] = going.map((r: { player_name: string }) => r.player_name);
  if (goingAll.length < 3) return { day, skipped: 'under_3', going: goingAll.length };

  const votedAtMap: Record<string, string> = {};
  const hoursMap: Record<string, number> = {};
  going.forEach((r: { player_name: string; voted_at?: string | null; hours?: number | null }) => {
    if (r.voted_at) votedAtMap[r.player_name] = r.voted_at;
    hoursMap[r.player_name] = r.hours ?? 2;
  });

  const { data: guestRows } = await supabase
    .from('guests').select('brought_by, friends').eq('week', week).eq('day', day);
  const guestsAll: { name: string; brought_by: string }[] = [];
  (guestRows ?? []).forEach((g: { brought_by: string; friends: string }) => {
    try {
      const friends: { name: string }[] = JSON.parse(g.friends || '[]');
      friends.forEach(f => guestsAll.push({ name: f.name, brought_by: g.brought_by }));
    } catch { /* ignore malformed */ }
  });

  // Attendee ordering mirrors completeSession: guests slot right after their
  // host via the host's voted_at + '~guest' suffix.
  const attendeeInput: Attendee[] = [
    ...goingAll.map(n => ({ name: n, isGuest: false, votedAt: votedAtMap[n] || '' })),
    ...guestsAll.map(g => ({
      name: g.name, isGuest: true, broughtBy: g.brought_by,
      votedAt: (g.brought_by ? (votedAtMap[g.brought_by] || '') : '') + '~guest',
    })),
  ];
  const wait = computeWaitlist(attendeeInput);
  const goingPlayers = wait.accepted.filter(a => !a.isGuest).map(a => a.name);
  const guests = wait.accepted
    .filter(a => a.isGuest)
    .map(a => guestsAll.find(g => g.name === a.name && g.brought_by === a.broughtBy))
    .filter((g): g is { name: string; brought_by: string } => !!g);

  const autoCourtsCount = wait.courtsOpen;
  const autoCourtsList = Array.from({ length: autoCourtsCount }, (_, i) => i + 1);
  const totalPeople = goingPlayers.length + guests.length;
  const sessionHours = Number(settings[`session_hours_${week}_${day}`]) || 2;
  const split = parseCourtSplit(settings[`court_split_${day}`]);
  const ratePerCourt = settings['court_rate'] ? parseFloat(settings['court_rate']) * 2 : 45.40;

  const { totalCost, effectiveCourtsCount, effectiveSessionHours } = computeSessionCost({
    totalCostOverride: null, split, courtsCount: autoCourtsCount, sessionHours, ratePerCourt,
  });
  const perPerson = computePerPerson(totalCost, totalPeople);
  const { playerCharges, guestCharges } = computeFinalizeCharges({ goingPlayers, guests, hoursMap, totalCost });

  const completedRow = {
    week, day, session_date: sessionDate,
    players: goingPlayers,
    guests: guests.map(g => ({ name: g.name, brought_by: g.brought_by })),
    courts: autoCourtsList,
    courts_count: effectiveCourtsCount,
    rate_per_court: ratePerCourt,
    session_hours: effectiveSessionHours,
    total_cost: totalCost,
    players_count: totalPeople,
    per_person: perPerson,
    auto_deducted: true,
    is_extra: false,
  };

  if (opts.dryRun) {
    return { day, week, completedRow, playerCharges, guestCharges };
  }

  const { data: newSession, error: csErr } = await supabase
    .from('completed_sessions').upsert(completedRow, { onConflict: 'week,day' }).select().single();
  if (csErr || !newSession) return { day, error: csErr?.message || 'completed_sessions upsert failed' };

  const uniqueNames = Array.from(new Set([...goingPlayers, ...guests.map(g => g.brought_by).filter(Boolean)]));
  const { data: playerRows } = await supabase.from('players').select('id, name').in('name', uniqueNames);
  const nameToId: Record<string, string> = {};
  (playerRows ?? []).forEach((p: { id: string; name: string }) => { nameToId[p.name] = p.id; });

  const ledger: Record<string, unknown>[] = [];
  playerCharges.forEach(({ name, amount }) => {
    const id = nameToId[name];
    if (id) ledger.push({ player_id: id, type: 'match_charge', amount: -amount, session_id: String(newSession.id), note: `Match — ${sessionDate} · ${day} (${week})` });
  });
  guestCharges.forEach(({ host, guest, amount }) => {
    const id = nameToId[host];
    if (id) ledger.push({ player_id: id, type: 'match_charge', amount: -amount, session_id: String(newSession.id), note: `Guest Charge — ${guest} hosted by ${host} · ${sessionDate}` });
  });

  if (ledger.length > 0) {
    const { error: txErr } = await supabase.from('transactions').insert(ledger);
    if (txErr) {
      // Roll back the finalized flag so a later run can retry cleanly.
      await supabase.from('completed_sessions').update({ auto_deducted: false }).eq('id', newSession.id);
      return { day, error: `ledger insert failed: ${txErr.message}` };
    }
  }

  return { day, finalized: true, session_id: newSession.id, players_count: totalPeople, per_person: perPerson, total_cost: totalCost };
}

Deno.serve(async (req: Request) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron: empty body */ }

  const { data: settingRows } = await supabase.from('settings').select('key, value');
  const settings: Record<string, string> = {};
  (settingRows ?? []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value; });

  if (body?.dryRun) {
    const days = body.day ? [body.day as Day] : [...REGULAR_DAYS];
    const results: DayResult[] = [];
    for (const d of days) results.push(await processDay(d, settings, { dryRun: true, forceWeek: body.week as string | undefined }));
    return new Response(JSON.stringify({ dryRun: true, results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const results: DayResult[] = [];
  let anyFinalized = false;
  for (const d of REGULAR_DAYS) {
    const r = await processDay(d, settings, {});
    results.push(r);
    if (r.finalized) anyFinalized = true;
  }

  // Fire the summary emails immediately after finalizing (don't wait for the
  // send-session-emails cron). Idempotent: send-session-emails dedups.
  if (anyFinalized) {
    try {
      await fetch(SEND_SESSION_EMAILS_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch (e) {
      console.error('finalize-regular-sessions: email trigger failed', e);
    }
  }

  return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
