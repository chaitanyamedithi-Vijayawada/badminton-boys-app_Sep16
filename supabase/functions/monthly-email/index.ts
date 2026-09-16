import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthLabel = firstOfLastMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    // Fetch completed sessions last month
    const { data: sessions } = await supabase
      .from("completed_sessions")
      .select("*")
      .gte("session_date", firstOfLastMonth.toISOString().split("T")[0])
      .lt("session_date", firstOfThisMonth.toISOString().split("T")[0]);

    // Fetch players (with id for joining transactions)
    const { data: playersData } = await supabase.from("players").select("id, name, email");
    if (!playersData) {
      return new Response(JSON.stringify({ error: "No players found" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Current balance is derived from the transactions ledger (the live source of
    // truth), NOT the legacy wallets table. balance = sum of every transaction.
    const { data: priorTxRaw } = await supabase
      .from("transactions")
      .select("player_id, amount")
      .lt("created_at", firstOfLastMonth.toISOString());

    const priorSumByPlayer: Record<string, number> = {};
    (priorTxRaw ?? []).forEach((tx: { player_id: string; amount: number }) => {
      priorSumByPlayer[tx.player_id] = (priorSumByPlayer[tx.player_id] ?? 0) + parseFloat(String(tx.amount));
    });

    // Build player id → name map
    const idToName: Record<string, string> = {};
    playersData.forEach((p: { id: string; name: string }) => {
      idToName[p.id] = p.name;
    });

    // Fetch ALL transactions in last month range (for top_ups)
    const { data: monthTxRaw } = await supabase
      .from("transactions")
      .select("player_id, type, amount, note, created_at")
      .gte("created_at", firstOfLastMonth.toISOString())
      .lt("created_at", firstOfThisMonth.toISOString())
      .order("created_at", { ascending: true });

    // Sum prior transactions per player to get balance at month start
    // balance_at_month_start = currentBalance - sum(monthTx.amount)
    const monthTxSumByPlayer: Record<string, number> = {};
    (monthTxRaw ?? []).forEach((tx: { player_id: string; amount: number }) => {
      monthTxSumByPlayer[tx.player_id] = (monthTxSumByPlayer[tx.player_id] ?? 0) + parseFloat(String(tx.amount));
    });

    const totalSessionsInMonth = (sessions ?? []).length;

    const emailPromises = playersData
      .filter((p: { name: string; email?: string | null }) => p.email)
      .map(async (p: { id: string; name: string; email: string }) => {
        const attended = (sessions ?? []).filter((s: { players: string[] | string }) => {
          const playerList = Array.isArray(s.players) ? s.players : JSON.parse(String(s.players || "[]"));
          return playerList.includes(p.name);
        });

        const totalDeducted = attended.reduce((sum: number, s: { per_person: number; guests: string | unknown[] }) => {
          const guestList = Array.isArray(s.guests) ? s.guests : JSON.parse(String(s.guests || "[]"));
          const myGuests = guestList.filter((g: { brought_by?: string }) => g.brought_by === p.name);
          return sum + s.per_person * (1 + myGuests.length);
        }, 0);

        const sessionDetails = attended.map((s: { session_date: string; day: string; per_person: number; guests: string | unknown[] }) => {
          const guestList = Array.isArray(s.guests) ? s.guests : JSON.parse(String(s.guests || "[]"));
          const myGuests = guestList.filter((g: { brought_by?: string }) => g.brought_by === p.name);
          return { date: s.session_date, day: s.day, perPerson: s.per_person, guests: myGuests.length };
        });

        // Ledger balance = sum of all prior-month transactions + this month's transactions.
        const monthSum = monthTxSumByPlayer[p.id] ?? 0;
        const currentBalance = (priorSumByPlayer[p.id] ?? 0) + monthSum;
        const attendanceRate = totalSessionsInMonth > 0 ? (attended.length / totalSessionsInMonth) * 100 : 0;

        // Compute before/after for each top_up this month by walking the month's
        // transactions in chronological order from the month-start balance.
        const allMonthTxForPlayer = (monthTxRaw ?? [])
          .filter((tx: { player_id: string }) => tx.player_id === p.id);

        const monthStartBalance = currentBalance - monthSum;

        // Walk this month's transactions in chronological order with a running
        // balance so each top-up's before/after is exact. (The previous version
        // matched by created_at via findIndex, which broke when two transactions
        // shared an identical timestamp.)
        let runningBalance = monthStartBalance;
        const topUpsAccurate: { date: string; amount: number; balanceBefore: number; balanceAfter: number; note: string }[] = [];
        for (const tx of allMonthTxForPlayer as { type: string; created_at: string; amount: number; note: string }[]) {
          const amount = parseFloat(String(tx.amount));
          const balBefore = runningBalance;
          runningBalance += amount;
          if (tx.type === "top_up") {
            topUpsAccurate.push({
              date: tx.created_at,
              amount,
              balanceBefore: balBefore,
              balanceAfter: runningBalance,
              note: tx.note || "",
            });
          }
        }

        return fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({
            type: "monthly",
            to: p.email,
            playerName: p.name,
            month: monthLabel,
            sessionsAttended: attended.length,
            totalDeducted,
            currentBalance,
            sessionDetails,
            attendanceRate,
            topUps: topUpsAccurate,
          }),
        }).catch((e) => console.error(`Email failed for ${p.name}:`, e));
      });

    await Promise.all(emailPromises);

    return new Response(JSON.stringify({ success: true, sent: emailPromises.length, month: monthLabel }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("monthly-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});