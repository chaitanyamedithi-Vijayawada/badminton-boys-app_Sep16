// Daily club checks, run once a day by pg_cron (18:00 UTC):
//  1. Low-balance reminders: push + email players whose balance is below the
//     admin-set threshold, at most once per repeat window.
//     Off unless settings.low_balance_reminders = 'on'.
//  2. Court-hours alert: push + email admins when the club's remaining court
//     hours drop below a threshold, repeating every few days while still low.
//     Off unless settings.court_hours_alert = 'on'.
// A { "dryRun": true } body reports what would happen without sending
// anything (used by the Admin tab previews).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  computeRemainingHours, courtAlertText, decideCourtAlert, planReminders, pushText,
  readCourtSettings, readSettings, type PlayerBalance,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const FN = `${SUPABASE_URL}/functions/v1`;
const COURT_LAST_KEY = "court_hours_alert_last";

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
    if (!res.ok) console.error(`daily checks: ${name} returned ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error(`daily checks: ${name} failed`, e);
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
    const courtSettings = readCourtSettings(map);
    const recipientName = map.payment_recipient_name || "Arun";

    const [players, txs, past, payments, sessions] = await Promise.all([
      supabase.from("players").select("id, name, email, archived, role"),
      supabase.from("transactions").select("player_id, amount"),
      supabase.from("low_balance_reminders").select("player_id, last_sent_at"),
      supabase.from("court_payments").select("hours_purchased, paid_at"),
      supabase.from("completed_sessions").select("courts_count, session_hours, created_at"),
    ]);
    for (const r of [players, txs, past, payments, sessions]) if (r.error) throw r.error;

    // ── 1. Low balances ──────────────────────────────────────────────────────
    const sums: Record<string, number> = {};
    (txs.data ?? []).forEach((t: { player_id: string; amount: number }) => {
      sums[t.player_id] = (sums[t.player_id] ?? 0) + Number(t.amount);
    });
    const balances: PlayerBalance[] = (players.data ?? []).map(
      (p: { id: string; name: string; email: string | null; archived: boolean | null }) => ({
        id: p.id, name: p.name, email: p.email, archived: !!p.archived, balance: sums[p.id] ?? 0,
      }),
    );
    const plan = planReminders(balances, past.data ?? [], settings);

    // ── 2. Court hours ───────────────────────────────────────────────────────
    const remainingHours = Math.round(
      computeRemainingHours(payments.data ?? [], sessions.data ?? [], map.hours_override) * 10,
    ) / 10;
    const courtDecision = decideCourtAlert(remainingHours, courtSettings, map[COURT_LAST_KEY]);
    const admins = (players.data ?? []).filter(
      (p: { role: string | null; archived: boolean | null }) => p.role === "admin" && !p.archived,
    ) as { name: string; email: string | null }[];

    const summary = {
      enabled: settings.enabled,
      threshold: settings.threshold,
      repeatDays: settings.repeatDays,
      wouldRemind: plan.toRemind.map(p => ({ name: p.name, balance: p.balance, hasEmail: !!p.email })),
      remindedRecently: plan.skippedRecent.map(p => ({ name: p.name, balance: p.balance })),
      courtHours: {
        enabled: courtSettings.enabled,
        threshold: courtSettings.threshold,
        repeatDays: courtSettings.repeatDays,
        remaining: remainingHours,
        isLow: remainingHours < courtSettings.threshold,
        decision: courtDecision,
        admins: admins.map(a => a.name),
      },
    };

    if (dryRun) return json({ dryRun: true, ...summary });

    // Low-balance reminders
    const sent: string[] = [];
    if (settings.enabled) {
      // Players back above the threshold: forget the old reminder so the next
      // drop gets a fresh one straight away.
      if (plan.toReset.length) {
        await supabase.from("low_balance_reminders").delete().in("player_id", plan.toReset);
      }
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
    }

    // Court-hours alert
    let courtAlertSent = false;
    if (courtDecision === "ok" && map[COURT_LAST_KEY]) {
      // Hours were topped up: next time they run low, alert straight away.
      await supabase.from("settings").delete().eq("key", COURT_LAST_KEY);
    } else if (courtDecision === "send") {
      const { title, body } = courtAlertText(remainingHours);
      const pushed = await callFunction("send-notification", {
        headings: { en: title },
        contents: { en: body },
        url: "https://badmintonboys.net",
        filters: [{ field: "tag", key: "is_admin", relation: "=", value: "true" }],
      });
      let emailed = false;
      for (const a of admins) {
        if (!a.email) continue;
        const ok = await callFunction("send-email", {
          type: "courthours",
          to: a.email,
          playerName: a.name,
          remaining: remainingHours,
          threshold: courtSettings.threshold,
        });
        emailed = emailed || ok;
      }
      if (pushed || emailed) {
        await supabase.from("settings").upsert(
          { key: COURT_LAST_KEY, value: new Date().toISOString() },
          { onConflict: "key" },
        );
        courtAlertSent = true;
      }
    }

    return json({ sent, courtAlertSent, ...summary });
  } catch (err) {
    console.error("daily checks error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
