import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const SEND_NOTIFICATION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const PACIFIC_TZ = 'America/Vancouver';
const REMINDER_LEAD_MS = 3 * 60 * 60 * 1000; // remind 3h before the voting cutoff

type Day = 'saturday' | 'wednesday';

// Interpret `${dateStr} ${time}` as PACIFIC wall-clock and return the true UTC
// instant in ms (DST-safe). Mirrors finalize-extra-sessions' pacificEndInstantMs.
function pacificWallInstantMs(dateStr: string, time: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, 0);
  const seenInPacific = new Date(new Date(asUTC).toLocaleString('en-US', { timeZone: PACIFIC_TZ }));
  const offset = asUTC - seenInPacific.getTime();
  return asUTC + offset;
}

// Current Pacific wall-clock date pieces + day-of-week.
function pacificNowParts(): { y: number; mo: number; d: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: Number(map.year), mo: Number(map.month), d: Number(map.day), dow: dowMap[map.weekday] };
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

// This Pacific week's Saturday date as Y-M-D.
function thisWeekSaturday(): string {
  const { y, mo, d, dow } = pacificNowParts();
  const sat = new Date(Date.UTC(y, mo - 1, d));
  sat.setUTCDate(sat.getUTCDate() + ((6 - dow + 7) % 7));
  return `${sat.getUTCFullYear()}-${pad(sat.getUTCMonth() + 1)}-${pad(sat.getUTCDate())}`;
}

// A Y-M-D string shifted by +/-N days (date-only math, no TZ involved).
function shiftDays(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// The upcoming session week key (the week's Saturday) for a given day type.
// Mirrors the client's getUpcomingSessionWeekKey: roll forward 7 days once this
// day's session ended 2h+ ago, so Wednesday advances to next week after it ends.
function upcomingWeekKey(day: Day): string {
  let sat = thisWeekSaturday();
  const sessionDate = day === 'saturday' ? sat : shiftDays(sat, -3);
  const endTime = day === 'saturday' ? '09:00' : '20:00';
  const sessionEndMs = pacificWallInstantMs(sessionDate, endTime);
  if (Date.now() >= sessionEndMs + 2 * 60 * 60 * 1000) {
    sat = shiftDays(sat, 7);
  }
  return sat;
}

// Send a single targeted push via the existing send-notification function
// (same player_name-tag filter the client uses, so delivery behaves identically).
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
    console.warn('session-reminders push error for', playerName, String(e));
  }
}

// Recipients = every non-archived player EXCEPT those who voted 'skip' for this
// week/day (i.e. non-voters + "going" voters).
async function recipientsFor(week: string, day: string): Promise<string[]> {
  const [{ data: players }, { data: skips }] = await Promise.all([
    supabase.from('players').select('name').or('archived.is.null,archived.eq.false'),
    supabase.from('rsvps').select('player_name').eq('week', week).eq('day', day).eq('status', 'skip'),
  ]);
  const skipSet = new Set((skips ?? []).map((r: { player_name: string }) => r.player_name));
  return (players ?? [])
    .map((p: { name: string }) => p.name)
    .filter((n: string) => !skipSet.has(n));
}

async function alreadySent(key: string): Promise<boolean> {
  const { data } = await supabase.from('reminders_sent').select('reminder_key').eq('reminder_key', key).maybeSingle();
  return !!data;
}

Deno.serve(async (req: Request) => {
  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch { /* cron sends an empty body */ }

  try {
    const nowMs = Date.now();

    // Settings map for cancelled / voting-locked gates.
    const { data: settingRows } = await supabase.from('settings').select('key, value');
    const settings: Record<string, string> = {};
    (settingRows ?? []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value; });

    const results: Record<string, unknown>[] = [];

    // Regular Saturday / Wednesday sessions.
    // Saturday cutoff = Thursday 6 PM (weekKey - 2d); Wednesday cutoff =
    // Tuesday 5 PM (weekKey - 4d), each in Pacific wall-clock.
    const regular: { day: Day; cutoffOffset: number; cutoffTime: string; label: string; closeTime: string }[] = [
      { day: 'saturday',  cutoffOffset: -2, cutoffTime: '18:00', label: 'Saturday',  closeTime: '6 PM' },
      { day: 'wednesday', cutoffOffset: -4, cutoffTime: '17:00', label: 'Wednesday', closeTime: '5 PM' },
    ];

    for (const r of regular) {
      const weekKey = upcomingWeekKey(r.day);
      const cutoffMs = pacificWallInstantMs(shiftDays(weekKey, r.cutoffOffset), r.cutoffTime);
      const reminderMs = cutoffMs - REMINDER_LEAD_MS;
      const key = `${r.day}-${weekKey}`;

      const cancelled = settings[`cancelled_${r.day}`] === 'true';
      const locked = r.day === 'saturday'
        ? settings['voting_locked_saturday'] === 'true'
        : (settings['voting_locked_wednesday'] === 'true' || settings['voting_locked_tuesday'] === 'true');

      const inWindow = nowMs >= reminderMs && nowMs < cutoffMs;

      if (!dryRun) {
        if (cancelled || locked) continue;
        if (!inWindow) continue;
        if (await alreadySent(key)) continue;
      }

      const recipients = await recipientsFor(weekKey, r.day);

      if (dryRun) {
        results.push({ day: r.day, week: weekKey, key, cancelled, locked, inWindow, reminderAt: new Date(reminderMs).toISOString(), cutoffAt: new Date(cutoffMs).toISOString(), recipients });
        continue;
      }

      const title = '🏸 Voting closes soon';
      const message = `${r.label} voting closes at ${r.closeTime} today — vote now, or cancel if your plans changed.`;
      await Promise.all(recipients.map(n => pushToPlayer(n, title, message)));

      await supabase.from('reminders_sent').insert({ reminder_key: key, recipients: recipients.length });
      results.push({ day: r.day, week: weekKey, sent: recipients.length });
    }

    // Extra sessions (only those with a cutoff_time set).
    const { data: extras } = await supabase
      .from('extra_sessions')
      .select('id, title, cutoff_time, cancelled')
      .eq('cancelled', false)
      .eq('auto_deducted', false)
      .not('cutoff_time', 'is', null);

    for (const s of extras ?? []) {
      const cutoffMs = new Date(s.cutoff_time).getTime();
      if (isNaN(cutoffMs)) continue;
      const reminderMs = cutoffMs - REMINDER_LEAD_MS;
      const key = `extra-${s.id}`;
      const inWindow = nowMs >= reminderMs && nowMs < cutoffMs;

      if (!dryRun) {
        if (!inWindow) continue;
        if (await alreadySent(key)) continue;
      }

      // For an extra session, "skip" voters live in extra_session_rsvps.
      const [{ data: players }, { data: skips }] = await Promise.all([
        supabase.from('players').select('name').or('archived.is.null,archived.eq.false'),
        supabase.from('extra_session_rsvps').select('player_name').eq('session_id', s.id).eq('status', 'skip'),
      ]);
      const skipSet = new Set((skips ?? []).map((x: { player_name: string }) => x.player_name));
      const recipients = (players ?? []).map((p: { name: string }) => p.name).filter((n: string) => !skipSet.has(n));

      if (dryRun) {
        results.push({ extra: s.id, title: s.title, key, inWindow, reminderAt: new Date(reminderMs).toISOString(), cutoffAt: new Date(cutoffMs).toISOString(), recipients });
        continue;
      }

      const closeLocal = new Date(cutoffMs).toLocaleTimeString('en-US', { timeZone: PACIFIC_TZ, hour: 'numeric', minute: '2-digit' });
      const title = '🏸 Voting closes soon';
      const message = `${s.title} voting closes at ${closeLocal} — vote now, or cancel if your plans changed.`;
      await Promise.all(recipients.map((n: string) => pushToPlayer(n, title, message)));

      await supabase.from('reminders_sent').insert({ reminder_key: key, recipients: recipients.length });
      results.push({ extra: s.id, sent: recipients.length });
    }

    return new Response(JSON.stringify({ success: true, dryRun, results }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
