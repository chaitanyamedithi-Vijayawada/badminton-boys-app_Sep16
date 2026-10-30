import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const SEND_EMAIL_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Auto-sends the summary email for a regular (Saturday/Wednesday) session once
// it has been finalized (by finalize-regular-sessions, the client, or the admin
// "Log past session" tool). This ONLY emails — it never finalizes or charges,
// so balances stay owned entirely by the finalize path. Dedup via
// session_emails_sent (keyed by completed_sessions.id) guarantees one send per
// session; history is pre-seeded so only sessions finalized from now on are
// ever emailed.
//
// A session is marked "emailed" ONLY when every eligible recipient's send
// actually succeeded (or there were no emails on file). If any send fails
// (e.g. Resend hiccup), the row is left unmarked so the next run retries,
// instead of silently recording a send that never landed.

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  let dryRun = false;
  try { dryRun = (await req.json())?.dryRun === true; } catch { /* cron: empty body */ }

  try {
    // Candidate sessions: regular, finalized, not yet emailed. Window to the last
    // 7 days as a belt-and-suspenders guard on top of the dedup table.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: sessions, error: sessErr } = await supabase
      .from('completed_sessions')
      .select('*')
      .eq('is_extra', false)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true });
    if (sessErr) throw sessErr;

    const { data: sentRows } = await supabase.from('session_emails_sent').select('session_id');
    const alreadySent = new Set((sentRows ?? []).map((r: { session_id: number }) => Number(r.session_id)));

    const pending = (sessions ?? []).filter((s: { id: number }) => !alreadySent.has(Number(s.id)));
    if (pending.length === 0) {
      return new Response(JSON.stringify({ success: true, dryRun, message: 'No sessions pending emails', results: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Settings (for Wednesday session time) + balances (from the full ledger).
    const { data: settingRows } = await supabase.from('settings').select('key, value');
    const settings: Record<string, string> = {};
    (settingRows ?? []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value; });

    const { data: playerRows } = await supabase.from('players').select('id, name, email');
    const nameToId: Record<string, string> = {};
    const nameToEmail: Record<string, string> = {};
    (playerRows ?? []).forEach((p: { id: string | number; name: string; email?: string | null }) => {
      nameToId[p.name] = String(p.id);
      if (p.email) nameToEmail[p.name] = p.email;
    });

    const { data: allTxns } = await supabase.from('transactions').select('player_id, amount');
    const balanceMap: Record<string, number> = {};
    (allTxns ?? []).forEach((t: { player_id: string | number | null; amount: number }) => {
      if (t.player_id != null) {
        const k = String(t.player_id);
        balanceMap[k] = (balanceMap[k] ?? 0) + Number(t.amount);
      }
    });

    const results: Record<string, unknown>[] = [];

    for (const cs of pending) {
      const day: string = cs.day;
      const sessionPlayers: string[] = cs.players ?? [];
      const sessionGuests: { name: string; brought_by?: string }[] = cs.guests ?? [];
      const perPerson = Number(cs.per_person);
      const sessionDate = cs.session_date ?? '';

      let sessionTime = '7:00 AM – 9:00 AM';
      if (day === 'wednesday') {
        try {
          const wedTime = JSON.parse(settings.wed_time || '{}');
          if (wedTime.start && wedTime.end) sessionTime = `${wedTime.start} – ${wedTime.end}`;
        } catch { /* fallback */ }
      }

      const hoursPlayed = cs.courts_count * (cs.session_hours ?? 2);
      const allPlayers = [...sessionPlayers, ...sessionGuests.map(g => g.name)];

      const recipients = dryRun ? [] as string[] : undefined;
      let eligible = 0;
      let sent = 0;
      let failed = 0;

      for (const name of sessionPlayers) {
        const email = nameToEmail[name];
        if (!email) continue;
        eligible++;
        const guestCount = sessionGuests.filter(g => g.brought_by === name).length;
        const totalDeducted = perPerson * (1 + guestCount);
        const newBalance = balanceMap[nameToId[name]] ?? 0;
        const oldBalance = newBalance + totalDeducted;

        if (dryRun) { recipients!.push(name); continue; }

        try {
          const res = await fetch(SEND_EMAIL_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'session',
              to: email,
              playerName: name,
              day,
              week: cs.week,
              sessionDate,
              sessionTime,
              hoursPlayed,
              courtsCount: cs.courts_count,
              playersCount: cs.players_count,
              perPerson,
              guestCount,
              totalDeducted,
              oldBalance,
              newBalance,
              allPlayers,
            }),
          });
          if (res.ok) sent++;
          else { failed++; console.error('send-session-emails: send-email rejected for', name, res.status); }
        } catch (e) {
          failed++;
          console.error('send-session-emails: send-email threw for', name, e);
        }
        await sleep(300); // stay under Resend's 5 req/sec free-tier cap
      }

      if (dryRun) {
        results.push({ session_id: cs.id, week: cs.week, day, would_email: recipients });
        continue;
      }

      // Mark emailed only when nothing needed sending or every eligible send
      // succeeded. A partial/total failure leaves the row unmarked → retried
      // on the next run, so a Resend outage can't permanently drop a session.
      if (eligible === 0 || failed === 0) {
        await supabase.from('session_emails_sent').insert({ session_id: cs.id, recipients: sent });
      }
      results.push({ session_id: cs.id, week: cs.week, day, eligible, sent, failed });
    }

    return new Response(JSON.stringify({ success: true, dryRun, results }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
