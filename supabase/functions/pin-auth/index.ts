import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Rate-limit config for the `login` action.
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const WINDOW_MINUTES = 15;

// Same algorithm as the old client-side hashPin (unsalted SHA-256 hex), so
// every existing stored PIN keeps working unchanged.
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Admin PIN ────────────────────────────────────────────────────────────────
// Stored hashed under settings.admin_pin_hash (not readable by the browser).
// Falls back to the legacy plain settings.admin_pin until it is migrated.
// Attempts are rate-limited under one shared bucket; the limit is looser than
// player logins so one person can't easily lock every admin out.
const ADMIN_HASH_KEY = "admin_pin_hash";
const ADMIN_BUCKET = "__admin__";
const ADMIN_MAX_FAILS = 10;
const ADMIN_LOCK_MINUTES = 10;

type Supa = ReturnType<typeof createClient>;

async function checkAdminPin(
  supabase: Supa,
  pin: string,
): Promise<{ ok: boolean; locked?: boolean; retryAfterSeconds?: number }> {
  if (!/^\d{4,8}$/.test(pin)) return { ok: false };

  const { data: attempt } = await supabase
    .from("pin_login_attempts")
    .select("fail_count, window_start, locked_until")
    .eq("name", ADMIN_BUCKET)
    .maybeSingle();
  if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
    return {
      ok: false,
      locked: true,
      retryAfterSeconds: Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 1000),
    };
  }

  const { data: rows } = await supabase
    .from("settings").select("key, value").in("key", [ADMIN_HASH_KEY, "admin_pin"]);
  const byKey = Object.fromEntries((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const ok = byKey[ADMIN_HASH_KEY]
    ? (await sha256Hex(pin)) === byKey[ADMIN_HASH_KEY]
    : !!byKey["admin_pin"] && pin === byKey["admin_pin"];

  if (ok) {
    if (attempt) await supabase.from("pin_login_attempts").delete().eq("name", ADMIN_BUCKET);
    return { ok: true };
  }

  const nowMs = Date.now();
  const withinWindow = !!attempt?.window_start &&
    (nowMs - new Date(attempt.window_start).getTime()) < WINDOW_MINUTES * 60_000;
  const fail_count = withinWindow ? ((attempt?.fail_count ?? 0) + 1) : 1;
  const locked_until = fail_count >= ADMIN_MAX_FAILS
    ? new Date(nowMs + ADMIN_LOCK_MINUTES * 60_000).toISOString()
    : null;
  await supabase.from("pin_login_attempts").upsert(
    {
      name: ADMIN_BUCKET,
      fail_count,
      window_start: withinWindow ? attempt!.window_start : new Date(nowMs).toISOString(),
      locked_until,
      updated_at: new Date(nowMs).toISOString(),
    },
    { onConflict: "name" },
  );
  return locked_until
    ? { ok: false, locked: true, retryAfterSeconds: ADMIN_LOCK_MINUTES * 60 }
    : { ok: false };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "login");

    // ── LOGIN ────────────────────────────────────────────────────────────────
    if (action === "login") {
      const name = String(body.name ?? "").trim();
      const pin = String(body.pin ?? "");
      if (!name || pin.length < 4) return json({ ok: false, error: "invalid_input" }, 400);

      const { data: attempt } = await supabase
        .from("pin_login_attempts")
        .select("fail_count, window_start, locked_until")
        .eq("name", name)
        .maybeSingle();

      if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
        const retryAfterSeconds = Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 1000);
        return json({ ok: false, locked: true, retryAfterSeconds });
      }

      const { data: player } = await supabase
        .from("players").select("pin").eq("name", name).maybeSingle();

      const ok = !!player?.pin && (await sha256Hex(pin)) === player.pin;

      if (ok) {
        await supabase.from("pin_login_attempts").delete().eq("name", name);
        return json({ ok: true });
      }

      const nowMs = Date.now();
      const withinWindow = !!attempt?.window_start &&
        (nowMs - new Date(attempt.window_start).getTime()) < WINDOW_MINUTES * 60_000;
      const fail_count = withinWindow ? ((attempt?.fail_count ?? 0) + 1) : 1;
      const window_start = withinWindow ? attempt!.window_start : new Date(nowMs).toISOString();
      const locked_until = fail_count >= MAX_FAILS
        ? new Date(nowMs + LOCK_MINUTES * 60_000).toISOString()
        : null;

      await supabase.from("pin_login_attempts").upsert(
        { name, fail_count, window_start, locked_until, updated_at: new Date(nowMs).toISOString() },
        { onConflict: "name" },
      );

      if (locked_until) {
        return json({ ok: false, locked: true, retryAfterSeconds: LOCK_MINUTES * 60 });
      }
      return json({ ok: false });
    }

    // ── SET / CHANGE PIN ──────────────────────────────────────────────────────
    if (action === "set") {
      const name = String(body.name ?? "").trim();
      const newPin = String(body.newPin ?? body.pin ?? "");
      const currentPin = body.currentPin != null ? String(body.currentPin) : null;
      if (!name || newPin.length < 4) return json({ ok: false, error: "invalid_input" }, 400);

      const { data: player } = await supabase
        .from("players").select("pin").eq("name", name).maybeSingle();
      if (!player) return json({ ok: false, error: "no_such_player" }, 404);

      // A player who already has a PIN must prove the current one to change it.
      if (player.pin) {
        if (!currentPin || (await sha256Hex(currentPin)) !== player.pin) {
          return json({ ok: false, error: "current_pin_required" });
        }
      }

      const { error } = await supabase
        .from("players").update({ pin: await sha256Hex(newPin) }).eq("name", name);
      if (error) return json({ ok: false, error: error.message }, 500);

      await supabase.from("pin_login_attempts").delete().eq("name", name);
      return json({ ok: true });
    }

    // ── ADMIN PIN: VERIFY ─────────────────────────────────────────────────────
    // The browser no longer sees the admin PIN; it sends what the admin typed
    // and the server answers yes/no (rate-limited).
    if (action === "verify-admin") {
      const result = await checkAdminPin(supabase, String(body.pin ?? ""));
      return json(result);
    }

    // ── ADMIN PIN: CHANGE ─────────────────────────────────────────────────────
    if (action === "set-admin") {
      const newPin = String(body.newPin ?? "");
      if (!/^\d{4,8}$/.test(newPin)) return json({ ok: false, error: "invalid_input" }, 400);
      const check = await checkAdminPin(supabase, String(body.currentPin ?? ""));
      if (!check.ok) return json({ ...check, error: "admin_auth_failed" }, 403);

      const { error } = await supabase.from("settings").upsert(
        { key: ADMIN_HASH_KEY, value: await sha256Hex(newPin) },
        { onConflict: "key" },
      );
      if (error) return json({ ok: false, error: error.message }, 500);
      // Drop the old plain-text copy once a hash exists.
      await supabase.from("settings").delete().eq("key", "admin_pin");
      return json({ ok: true });
    }

    // ── ADMIN RESET ───────────────────────────────────────────────────────────
    if (action === "reset") {
      const playerId = String(body.playerId ?? "");
      if (!playerId) return json({ ok: false, error: "invalid_input" }, 400);

      const check = await checkAdminPin(supabase, String(body.adminPin ?? ""));
      if (!check.ok) return json({ ...check, error: "admin_auth_failed" }, 403);

      const { error } = await supabase
        .from("players").update({ pin: null }).eq("id", playerId);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (err) {
    console.error("pin-auth error:", err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
