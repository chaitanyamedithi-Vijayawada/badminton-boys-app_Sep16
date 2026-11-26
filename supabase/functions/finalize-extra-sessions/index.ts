import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const SEND_EMAIL_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const PACIFIC_TZ = 'America/Vancouver';
const FINALIZE_BUFFER_MS = 2 * 60 * 60 * 1000; // finalize 2h AFTER the session ends

// Interpret `${dateStr}T${endTime}` as PACIFIC wall-clock time and return the
// true UTC instant (DST-safe). The previous code did `new Date(dateStr+'T'+end)`,
// which the Deno runtime parses as UTC — so a 7:00 PM Pacific end was treated as
// 7:00 PM UTC (= noon Pacific), finalizing ~7 hours early, before the session.
function pacificEndInstantMs(dateStr: string, endTime: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = endTime.split(':').map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, 0);
  const seenInPacific = new Date(new Date(asUTC).toLocaleString('en-US', { timeZone: PACIFIC_TZ }));
  const offset = asUTC - seenInPacific.getTime(); // Pacific offset for THIS date (handles DST)
  return asUTC + offset;
}

// Actual session length in hours from start/end (e.g. 18:00–19:00 = 1).
function sessionHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

Deno.serve(async () => {
  try {
    const nowMs = Date.now();

    const { data: sessions, error: sessErr } = await supabase
      .from('extra_sessions')
      .select('*')
      .eq('auto_deducted', false)
      .eq('cancelled', false);

    if (sessErr) throw sessErr;
    if (!sessions?.length) {
      return new Response(JSON.stringify({ message: 'No sessions to finalize' }), { status: 200 });
    }

    const results: string[] = [];

    for (const session of sessions) {
      // Only finalize once the session has actually ended (Pacific) + a 2h buffer.
      const readyMs = pacificEndInstantMs(session.session_date, session.end_time) + FINALIZE_BUFFER_MS;
      if (nowMs < readyMs) continue;

      // 1. Get going RSVPs
      const { data: rsvps } = await supabase
        .from('extra_session_rsvps')
        .select('player_name')
        .eq('session_id', session.id)
        .eq('status', 'going');

      const goingNames: string[] = (rsvps ?? []).map((r: { player_name: string }) => r.player_name);

      if (goingNames.length === 0) {
        await supabase.from('extra_sessions').update({ auto_deducted: true }).eq('id', session.id);
        results.push(`Session ${session.id} "${session.title}": no players, marked done`);
        continue;
      }

      // 2. Get guests
      const { data: guestRows } = await supabase
        .from('extra_session_guests')
        .select('*')
        .eq('session_id', session.id);

      const guests: { name: string; brought_by: string }[] = (guestRows ?? []).flatMap(
        (row: { brought_by: string; friends: string }) => {
          try {
            const friends: { name: string }[] = JSON.parse(row.friends);
            return friends.map(f => ({ name: f.name, brought_by: row.brought_by }));
          } catch { return []; }
        }
      );

      // 3. Get court rate from settings
      const { data: settings } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'court_rate')
        .maybeSingle();

      // court_rate is PER COURT PER HOUR. Bill for the session's ACTUAL length —
      // the old code multiplied by a flat 2-hour rate, so a 1-hour session was
      // charged double. This mirrors the client's completeExtraSession:
      //   totalCost = courts × perHourRate × hours
      const perHourRate = settings?.value ? parseFloat(settings.value) : 22.70;
      const hours = sessionHours(session.start_time, session.end_time);
      const totalCost = session.courts.length * perHourRate * hours;
      const totalPeople = goingNames.length + guests.length;
      const perPerson = totalPeople > 0 ? totalCost / totalPeople : 0;
      const sessionDate = session.session_date;

      // 4. Mark session as deducted
      await supabase.from('extra_sessions').update({
        auto_deducted: true,
        per_person: perPerson,
        total_cost: totalCost,
        players_count: totalPeople,
      }).eq('id', session.id);

      // 5. Insert into completed_sessions for court hours + history.
      // Use a per-session week key (extra-<id>-<date>) — matching the client's
      // completeExtraSession — so an extra session can never collide with and
      // overwrite a real Saturday regular session that shares the same date.
      await supabase.from('completed_sessions').upsert({
        week: `extra-${session.id}-${sessionDate}`,
        day: 'saturday',
        session_date: sessionDate,
        players: goingNames,
        guests,
        courts: session.courts,
        courts_count: session.courts.length,
        rate_per_court: perHourRate * 2,
        total_cost: totalCost,
        players_count: totalPeople,
        per_person: perPerson,
        auto_deducted: true,
        is_extra: true,
        hours,
        session_hours: hours,
      }, { onConflict: 'week,day' });

      // 6. Resolve player IDs + emails
      const uniqueNames = Array.from(new Set([
        ...goingNames,
        ...guests.map(g => g.brought_by).filter(Boolean),
      ]));

      const { data: playerRows } = await supabase
        .from('players')
        .select('id, name, email')
        .in('name', uniqueNames);

      if (!playerRows?.length) {
        results.push(`Session ${session.id}: no matching players found`);
        continue;
      }

      const nameToId: Record<string, string> = {};
      const nameToEmail: Record<string, string> = {};
      playerRows.forEach((p: { id: string; name: string; email?: string | null }) => {
        nameToId[p.name] = p.id;
        if (p.email) nameToEmail[p.name] = p.email;
      });

      // 7. Build + insert transactions
      const txns: Record<string, unknown>[] = [];
      goingNames.forEach(name => {
        const playerId = nameToId[name];
        if (playerId) txns.push({
          player_id: playerId,
          type: 'match_charge',
          amount: -perPerson,
          note: `Extra Session — ${session.title} · ${sessionDate}`,
        });
      });
      guests.forEach(g => {
        if (g.brought_by) {
          const hostId = nameToId[g.brought_by];
          if (hostId) txns.push({
            player_id: hostId,
            type: 'match_charge',
            amount: -perPerson,
            note: `Guest Charge — ${g.name} hosted by ${g.brought_by} · Extra Session ${session.title} · ${sessionDate}`,
          });
        }
      });

      if (txns.length > 0) {
        const { error: txErr } = await supabase.from('transactions').insert(txns);
        if (txErr) throw txErr;
      }

      // 8. Fetch updated balances for email
      const { data: updatedTxns } = await supabase
        .from('transactions')
        .select('player_id, amount');

      const balanceMap: Record<string, number> = {};
      (updatedTxns ?? []).forEach((t: { player_id: string; amount: number }) => {
        balanceMap[t.player_id] = (balanceMap[t.player_id] || 0) + Number(t.amount);
      });

      // 9. Send emails to each going player.
      // Name the email by the session's TITLE (and let the real date render),
      // instead of the old hardcoded day:'saturday' that mislabeled every
      // extra-session email as a Saturday session.
      for (const name of goingNames) {
        const email = nameToEmail[name];
        if (!email) continue;

        const playerId = nameToId[name];
        const newBalance = balanceMap[playerId] ?? 0;
        const guestCount = guests.filter(g => g.brought_by === name).length;
        const totalDeducted = perPerson * (1 + guestCount);
        const oldBalance = newBalance + totalDeducted;

        const emailPayload = {
          type: 'session',
          to: email,
          playerName: name,
          day: session.title,
          week: sessionDate,
          sessionDate,
          sessionTime: `${session.start_time} – ${session.end_time}`,
          hoursPlayed: session.courts.length * hours,
          courtsCount: session.courts.length,
          playersCount: totalPeople,
          perPerson,
          guestCount,
          totalDeducted,
          oldBalance,
          newBalance,
          allPlayers: goingNames,
        };

        await fetch(SEND_EMAIL_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailPayload),
        });
      }

      results.push(`Session ${session.id} "${session.title}": ${hours}h × ${session.courts.length} court, deducted $${perPerson.toFixed(2)} from ${totalPeople} people`);
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
