import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PACIFIC_TZ = "America/Vancouver";

function getNowPacific(): Date {
  const now = new Date();
  const pacificStr = now.toLocaleString("en-US", { timeZone: PACIFIC_TZ });
  return new Date(pacificStr);
}

function getWeekKey(): string {
  const now = getNowPacific();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split("T")[0];
}

function isSessionEndPassed(day: "saturday" | "wednesday", satEndHour = 9, wedEndHour = 20): boolean {
  const now = getNowPacific();
  const dow = now.getDay();
  const hour = now.getHours();
  if (day === "saturday") {
    return dow === 6 && hour >= satEndHour;
  } else {
    return dow === 3 && hour >= wedEndHour;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { day } = await req.json() as { day: "saturday" | "wednesday" };
    if (!day || (day !== "saturday" && day !== "wednesday")) {
      return new Response(JSON.stringify({ error: "Invalid day" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const week = getWeekKey();

    // Guard: refuse to finalize before the session has actually ended.
    // Without this, an early call would deduct money and send emails
    // before the session is played.
    let wedEndHour = 20;
    {
      const { data: wedSetting } = await supabase
        .from("settings").select("value").eq("key", "wed_time").maybeSingle();
      try {
        const wedTime = JSON.parse(wedSetting?.value || "{}");
        if (wedTime.end) wedEndHour = Number(wedTime.end.split(":")[0]) || 20;
      } catch { /* fallback to 20 */ }
    }
    if (!isSessionEndPassed(day, 9, wedEndHour)) {
      return new Response(JSON.stringify({ error: "Session has not ended yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if already completed
    const { data: existing } = await supabase
      .from("completed_sessions")
      .select("id")
      .eq("week", week)
      .eq("day", day)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ message: "Already completed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FIX 1: Fetch RSVPs filtered by BOTH week and day
    const { data: rsvps } = await supabase
      .from("rsvps")
      .select("player_name, status")
      .eq("week", week)
      .eq("day", day);

    const goingPlayers: string[] = (rsvps ?? [])
      .filter((r: { status: string }) => r.status === "going")
      .map((r: { player_name: string }) => r.player_name);

    if (goingPlayers.length < 3) {
      return new Response(JSON.stringify({ error: "Not enough players to complete session" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FIX 1: Fetch guests filtered by BOTH week and day
    const { data: guestRows } = await supabase
      .from("guests")
      .select("brought_by, friends")
      .eq("week", week)
      .eq("day", day);

    const guests: { name: string; brought_by: string }[] = [];
    (guestRows ?? []).forEach((r: { brought_by: string; friends: string }) => {
      try {
        const friends = JSON.parse(r.friends || "[]");
        friends.forEach((f: { name: string }) => guests.push({ name: f.name, brought_by: r.brought_by }));
      } catch (_) { /* ignore */ }
    });

    // Fetch settings for courts, rate, and session time
    const { data: settingsRows } = await supabase.from("settings").select("key, value");
    const settings: Record<string, string> = {};
    (settingsRows ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });

    const courtKey = day === "saturday" ? "courts_saturday" : "courts_wednesday";
    let courts: number[] = [];
    try {
      courts = JSON.parse(settings[courtKey] || "[]");
    } catch (_) { courts = []; }

    if (courts.length === 0) {
      return new Response(JSON.stringify({ error: "No courts configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve session time
    let sessionTime = "7:00 AM – 9:00 AM";
    if (day === "wednesday") {
      try {
        const wedTime = JSON.parse(settings["wed_time"] || "{}");
        if (wedTime.start && wedTime.end) {
          sessionTime = `${wedTime.start} – ${wedTime.end}`;
        }
      } catch (_) { /* fallback */ }
    }

    const hoursPlayed = courts.length * 2;
    const courtRate = parseFloat(settings.court_rate || "22.70") || 22.70;
    const ratePerCourt = courtRate * 2;
    const totalPeople = goingPlayers.length + guests.length;
    const totalCost = courts.length * ratePerCourt;
    const perPerson = totalPeople > 0 ? totalCost / totalPeople : 0;
    const sessionDate = new Date().toISOString().split("T")[0];

    // Insert completed session
    const { error: sessionError } = await supabase.from("completed_sessions").upsert({
      week,
      day,
      session_date: sessionDate,
      players: goingPlayers,
      guests: guests.map(g => ({ name: g.name, brought_by: g.brought_by })),
      courts,
      courts_count: courts.length,
      rate_per_court: ratePerCourt,
      total_cost: totalCost,
      players_count: totalPeople,
      per_person: perPerson,
      auto_deducted: true,
    }, { onConflict: "week,day" });

    if (sessionError) {
      return new Response(JSON.stringify({ error: sessionError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if deduction already done
    const { data: existingDeduction } = await supabase
      .from("session_deductions")
      .select("id")
      .eq("week", week)
      .eq("day", day)
      .maybeSingle();

    if (!existingDeduction) {
      // Insert deduction record
      await supabase.from("session_deductions").upsert({
        week,
        day,
        courts_count: courts.length,
        rate_per_court: ratePerCourt,
        total_cost: totalCost,
        players_count: totalPeople,
        per_person: perPerson,
        deducted_by: "Auto",
      }, { onConflict: "week,day" });

      // Fund entry
      const courtHoursForSession = courts.length * 2;
      await supabase.from("fund_entries").insert({
        amount: -totalCost,
        entered_by: "Auto",
        notes: `Court payment: ${courtHoursForSession}hrs — ${courts.length} courts x $${ratePerCourt.toFixed(2)} — ${day} ${week}`,
      });

      // Update total_court_hours setting
      const prevHours = parseFloat(settings.total_court_hours || "0") || 0;
      await supabase.from("settings").upsert(
        { key: "total_court_hours", value: String(prevHours + courtHoursForSession) },
        { onConflict: "key" }
      );

      // Update total_paid_club setting
      const prevPaid = parseFloat(settings.total_paid_club || "0") || 0;
      await supabase.from("settings").upsert(
        { key: "total_paid_club", value: String(prevPaid + totalCost) },
        { onConflict: "key" }
      );

      // Fetch all wallets BEFORE deductions (for correct old balance in email)
      const { data: walletsData } = await supabase.from("wallets").select("player_name, balance");
      const balanceMap: Record<string, number> = {};
      (walletsData ?? []).forEach((w: { player_name: string; balance: number }) => {
        balanceMap[w.player_name] = parseFloat(String(w.balance)) || 0;
      });

      // Deduct going players
      for (const playerName of goingPlayers) {
        const currentBalance = balanceMap[playerName] ?? 0;
        const newBalance = currentBalance - perPerson;
        await supabase.from("wallets").upsert({
          player_name: playerName,
          balance: newBalance,
          prev_balance: currentBalance,
          last_deduction: perPerson,
          last_session: `${day} ${week}`,
        }, { onConflict: "player_name" });
      }

      // Deduct guest hosts
      for (const guest of guests) {
        if (guest.brought_by) {
          const currentBalance = balanceMap[guest.brought_by] ?? 0;
          const newBalance = currentBalance - perPerson;
          await supabase.from("wallets").upsert({
            player_name: guest.brought_by,
            balance: newBalance,
            prev_balance: currentBalance,
            last_deduction: perPerson,
            last_session: `${day} ${week} (guest: ${guest.name})`,
          }, { onConflict: "player_name" });
        }
      }

      // Fetch fresh player emails
      const { data: playersData } = await supabase.from("players").select("name, email");
      const emailMap: Record<string, string> = {};
      (playersData ?? []).forEach((p: { name: string; email?: string | null }) => {
        if (p.email) emailMap[p.name] = p.email;
      });

      // Fetch updated wallets AFTER deductions (for new balance in email)
      const { data: updatedWallets } = await supabase.from("wallets").select("player_name, balance");
      const newBalanceMap: Record<string, number> = {};
      (updatedWallets ?? []).forEach((w: { player_name: string; balance: number }) => {
        newBalanceMap[w.player_name] = parseFloat(String(w.balance)) || 0;
      });

      const emailPromises = goingPlayers
        .filter(name => emailMap[name])
        .map(name => {
          const guestCount = guests.filter(g => g.brought_by === name).length;
          const totalDeducted = (1 + guestCount) * perPerson;
          // FIX 2: Use pre-deduction balance directly
          const oldBal = balanceMap[name] ?? 0;
          const newBal = newBalanceMap[name] ?? 0;

          return fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "apikey": SUPABASE_SERVICE_ROLE_KEY,
            },
            body: JSON.stringify({
              type: "session",
              to: emailMap[name],
              playerName: name,
              day,
              week,
              sessionDate,
              sessionTime,
              hoursPlayed,
              courtsCount: courts.length,
              playersCount: totalPeople,
              perPerson,
              guestCount,
              totalDeducted,
              oldBalance: oldBal,
              newBalance: newBal,
              allPlayers: goingPlayers,
            }),
          }).catch(e => console.error(`Email failed for ${name}:`, e));
        });

      await Promise.all(emailPromises);
    }

    return new Response(JSON.stringify({ success: true, week, day, goingPlayers, perPerson, totalCost }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("complete-session error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});