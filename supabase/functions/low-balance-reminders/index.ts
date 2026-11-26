// Low-balance reminders: once a day (pg_cron), push + email players whose
// balance is below the admin-set threshold, at most once per repeat window.
// Off unless settings.low_balance_reminders = 'on'. A { "dryRun": true } body
// returns who would be reminded without sending anything (used by the Admin
// tab preview).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { planReminders, pushText, readSettings, type PlayerBalance } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const FN = `${SUPABASE_URL}/functions/v1`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callFunction(name: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${FN}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`low-balance-reminders: ${name} returned ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error(`low-balance-reminders: ${name} failed`, e);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch { /* cron sends {} */ }

  try {
    const { data: settingRows, error: sErr } = await supabase.from("settings").select("key, value");
    if (sErr) throw sErr;
    const map: Record<string, string> = {};
    (settingRows ?? []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
    const settings = readSettings(map);
    const recipientName = map.payment_recipient_name || "Arun";

    const [{ data: playerRows, error: pErr }, { data: txRows, error: tErr }, { data: past, error: rErr }] =
      await Promise.all([
        supabase.from("players").select("id, name, email, archived"),
        supabase.from("transactions").select("player_id, amount"),
        supabase.from("low_balance_reminders").select("player_id, last_sent_at"),
      ]);
    if (pErr) throw pErr;
    if (tErr) throw tErr;
    if (rErr) throw rErr;

    const sums: Record<string, number> = {};
    (txRows ?? []).forEach((t: { player_id: string; amount: number }) => {
      sums[t.player_id] = (sums[t.player_id] ?? 0) + Number(t.amount);
    });
    const players: PlayerBalance[] = (playerRows ?? []).map(
      (p: { id: string; name: string; email: string | null; archived: boolean | null }) => ({
        id: p.id, name: p.name, email: p.email, archived: !!p.archived, balance: sums[p.id] ?? 0,
      }),
    );

    const plan = planReminders(players, past ?? [], settings);
    const summary = {
      enabled: settings.enabled,
      threshold: settings.threshold,
      repeatDays: settings.repeatDays,
      wouldRemind: plan.toRemind.map(p => ({ name: p.name, balance: p.balance, hasEmail: !!p.email })),
      remindedRecently: plan.skippedRecent.map(p => ({ name: p.name, balance: p.balance })),
    };

    if (dryRun) return json({ dryRun: true, ...summary });
    if (!settings.enabled) return json({ skipped: "disabled", ...summary });

    // Players back above the threshold: forget the old reminder so the next
    // drop gets a fresh one straight away.
    if (plan.toReset.length) {
      await supabase.from("low_balance_reminders").delete().in("player_id", plan.toReset);
    }

    const sent: string[] = [];
    for (const p of plan.toRemind) {
      const { title, body } = pushText(p, recipientName);
      // One push per player (OR-combined tag filters did not deliver).
      const pushed = await callFunction("send-notification", {
        headings: { en: title },
        contents: { en: body },
        url: "https://badmintonboys.net",
        filters: [{ field: "tag", key: "player_name", relation: "=", value: p.name }],
      });
      const emailed = p.email
        ? await callFunction("send-email", {
            type: "lowbalance",
            to: p.email,
            playerName: p.name,
            balance: p.balance,
            threshold: settings.threshold,
            recipientName,
          })
        : false;
      if (pushed || emailed) {
        await supabase.from("low_balance_reminders").upsert(
          { player_id: p.id, last_sent_at: new Date().toISOString(), balance_at_send: p.balance },
          { onConflict: "player_id" },
        );
        sent.push(p.name);
      }
    }
    return json({ sent, ...summary });
  } catch (err) {
    console.error("low-balance-reminders error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
