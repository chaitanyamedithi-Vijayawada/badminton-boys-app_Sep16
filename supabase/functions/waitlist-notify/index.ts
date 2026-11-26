import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const SEND_NOTIFICATION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const PACIFIC_TZ = 'America/Vancouver';
type Day = 'saturday' | 'wednesday';

// Waitlist math - mirrors src/lib/waitlist.ts exactly.
const MAX_COURTS = 4;
const BASE_PER_COURT = 4;
const EXTRA_PER_COURT = 1;
function capacityFor(courts: number): number { return courts * (BASE_PER_COURT + EXTRA_PER_COURT); }
function courtsOpenFor(total: number): number {
  return Math.min(Math.max(0, Math.floor(total / BASE_PER_COURT)), MAX_COURTS);
}
interface Attendee { name: string; isGuest: boolean; votedAt: string; }
function computeWaitlist(attendees: Attendee[]): { accepted: Attendee[]; waitlisted: Attendee[] } {
  const ordered = [...attendees].sort((a, b) => {
    const ta = a.votedAt || '￿';
    const tb = b.votedAt || '￿';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const total = ordered.length;
  const capacity = capacityFor(courtsOpenFor(total));
  const acceptedCount = Math.min(total, capacity);
  return { accepted: ordered.slice(0, acceptedCount), waitlisted: ordered.slice(acceptedCount) };
}

// Pacific week-key (mirrors getUpcomingSessionWeekKey).
function pacificWallInstantMs(dateStr: string, time: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, 0);
  const seenInPacific = new Date(new Date(asUTC).toLocaleString('en-US', { timeZone: PACIFIC_TZ }));
  return asUTC + (asUTC - seenInPacific.getTime());
}
function pad(n: number): string { return String(n).padStart(2, '0'); }
function thisWeekSaturday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value;
  const dow: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const sat = new Date(Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day)));
  sat.setUTCDate(sat.getUTCDate() + ((6 - dow[m.weekday] + 7) % 7));
  return `${sat.getUTCFullYear()}-${pad(sat.getUTCMonth() + 1)}-${pad(sat.getUTCDate())}`;
}
function shiftDays(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function upcomingWeekKey(day: Day): string {
  let sat = thisWeekSaturday();
  const sessionDate = day === 'saturday' ? sat : shiftDays(sat, -3);
  const endTime = day === 'saturday' ? '09:00' : '20:00';
  if (Date.now() >= pacificWallInstantMs(sessionDate, endTime) + 2 * 60 * 60 * 1000) {
    sat = shiftDays(sat, 7);
  }
  return sat;
}

async function pushToPlayer(playerName: string, title: string, message: string) {
  try {
    await fetch(SEND_NOTIFICATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}`, 'apikey': ANON_KEY },
      body: JSON.stringify({
        headings: { en: title },
        contents: { en: message },
        filters: [{ field: 'tag', key: 'player_name', relation: '=', value: playerName }],
      }),
    });
  } catch (e) {
    console.warn('waitlist-notify push error for', playerName, String(e));
  }
}

Deno.serve(async (req: Request) => {
  let dryRun = false;
  try { dryRun = (await req.json())?.dryRun === true; } catch { /* cron: empty body */ }

  try {
    const { data: settingRows } = await supabase.from('settings').select('key, value');
    const settings: Record<string, string> = {};
    (settingRows ?? []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value; });

    const results: Record<string, unknown>[] = [];

    for (const day of ['saturday', 'wednesday'] as Day[]) {
      const week = upcomingWeekKey(day);

      const cancelled = settings[`cancelled_${day}`] === 'true';
      const locked = day === 'saturday'
        ? settings['voting_locked_saturday'] === 'true'
        : (settings['voting_locked_wednesday'] === 'true' || settings['voting_locked_tuesday'] === 'true');
      if (cancelled || locked) { results.push({ day, week, skipped: cancelled ? 'cancelled' : 'locked' }); continue; }

      const { data: rsvpRows } = await supabase
        .from('rsvps').select('player_name, voted_at')
        .eq('week', week).eq('day', day).eq('status', 'going');
      const { data: guestRows } = await supabase
        .from('guests').select('brought_by, friends, created_at')
        .eq('week', week).eq('day', day);

      const tsByName: Record<string, string> = {};
      const members: Attendee[] = (rsvpRows ?? []).map((r: { player_name: string; voted_at: string | null }) => {
        tsByName[r.player_name] = r.voted_at ?? '';
        return { name: r.player_name, isGuest: false, votedAt: r.voted_at ?? '' };
      });
      const guests: Attendee[] = [];
      (guestRows ?? []).forEach((g: { brought_by: string; friends: string; created_at: string }) => {
        let friends: { name: string }[] = [];
        try { friends = JSON.parse(g.friends); } catch { /* ignore */ }
        // Order guests by their own add-time (guests.created_at), matching the
        // client's lib/waitlist.ts; fall back to the host's vote time if absent.
        friends.forEach(f => guests.push({
          name: f.name, isGuest: true, votedAt: g.created_at || (tsByName[g.brought_by] ?? ''),
        }));
      });

      const { accepted, waitlisted } = computeWaitlist([...members, ...guests]);
      const acceptedMembers = accepted.filter(a => !a.isGuest).map(a => a.name);
      const waitlistedMembers = waitlisted.filter(a => !a.isGuest).map(a => a.name);

      const { data: prev } = await supabase
        .from('waitlist_state').select('accepted, waitlisted')
        .eq('week', week).eq('day', day).maybeSingle();

      if (!prev) {
        if (!dryRun) {
          await supabase.from('waitlist_state').upsert(
            { week, day, accepted: acceptedMembers, waitlisted: waitlistedMembers, updated_at: new Date().toISOString() },
            { onConflict: 'week,day' });
        }
        results.push({ day, week, baseline: true, accepted: acceptedMembers, waitlisted: waitlistedMembers });
        continue;
      }

      const prevAccepted = new Set<string>(prev.accepted ?? []);
      const prevWaitlisted = new Set<string>(prev.waitlisted ?? []);
      const promoted = acceptedMembers.filter(n => prevWaitlisted.has(n));
      const demoted = waitlistedMembers.filter(n => prevAccepted.has(n));

      if (dryRun) {
        results.push({ day, week, promoted, demoted, accepted: acceptedMembers, waitlisted: waitlistedMembers });
        continue;
      }

      const label = day === 'saturday' ? 'Saturday' : 'Wednesday';
      await Promise.all([
        ...promoted.map(n => pushToPlayer(n, "🏸 You're in!",
          `A spot opened up — you're off the waitlist for ${label}'s session.`)),
        ...demoted.map(n => pushToPlayer(n, '📋 Moved to the waitlist',
          `${label}'s lineup changed and a court closed — you're back on the waitlist for now.`)),
      ]);

      await supabase.from('waitlist_state').upsert(
        { week, day, accepted: acceptedMembers, waitlisted: waitlistedMembers, updated_at: new Date().toISOString() },
        { onConflict: 'week,day' });

      results.push({ day, week, promoted, demoted });
    }

    return new Response(JSON.stringify({ success: true, dryRun, results }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
