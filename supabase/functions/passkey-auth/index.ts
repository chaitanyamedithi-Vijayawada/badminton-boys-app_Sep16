import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@14";
import { isoBase64URL } from "npm:@simplewebauthn/server@14/helpers";

// Face ID / fingerprint login via passkeys (WebAuthn).
//
// Flow:
//   register-options  (name + PIN)  -> challenge for a new passkey on this device
//   register-verify   (name + resp) -> store the device's PUBLIC key
//   login-options     (name)        -> challenge for that player's passkeys
//   login-verify      (name + resp) -> verify signature with stored public key
//   remove            (name + PIN)  -> delete all of that player's passkeys
//
// Registering requires the player's PIN, so nobody can attach their own Face ID
// to someone else's name. Nothing secret is stored: only public keys.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const RP_NAME = "Badminton Boys";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Which site is asking decides the passkey's "relying party". Passkeys made on
// badmintonboys.net work on both the bare and www host. Vercel preview hosts
// get their own (test-only) passkeys because vercel.app is a public suffix.
function rpFor(origin: string | null): { rpID: string; origin: string } | null {
  if (!origin) return null;
  let u: URL;
  try { u = new URL(origin); } catch { return null; }
  const host = u.hostname;
  if (u.protocol === "https:" && (host === "badmintonboys.net" || host === "www.badmintonboys.net")) {
    return { rpID: "badmintonboys.net", origin };
  }
  if (u.protocol === "https:" && /^badmintonboys-[a-z0-9-]+-chaitanya-badminton-app\.vercel\.app$/.test(host)) {
    return { rpID: host, origin };
  }
  if (host === "localhost") return { rpID: "localhost", origin };
  return null;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pinMatches(name: string, pin: string): Promise<boolean> {
  if (!pin || pin.length < 4) return false;
  const { data } = await supabase.from("players").select("pin").eq("name", name).maybeSingle();
  return !!data?.pin && (await sha256Hex(pin)) === data.pin;
}

async function saveChallenge(name: string, kind: "register" | "login", challenge: string) {
  await supabase.from("passkey_challenges").upsert(
    { player_name: name, kind, challenge, created_at: new Date().toISOString() },
    { onConflict: "player_name,kind" },
  );
}

// One-time use: read and delete in the same step, and reject stale ones.
async function takeChallenge(name: string, kind: "register" | "login"): Promise<string | null> {
  const { data } = await supabase
    .from("passkey_challenges")
    .delete()
    .eq("player_name", name).eq("kind", kind)
    .select("challenge, created_at")
    .maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.created_at).getTime() > CHALLENGE_TTL_MS) return null;
  return data.challenge;
}

async function passkeysFor(name: string) {
  const { data } = await supabase
    .from("player_passkeys")
    .select("id, public_key, counter, transports")
    .eq("player_name", name);
  return data ?? [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const rp = rpFor(req.headers.get("origin"));
    if (!rp) return json({ ok: false, error: "origin_not_allowed" }, 403);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const name = String(body.name ?? "").trim();
    if (!name) return json({ ok: false, error: "invalid_input" }, 400);

    const { data: player } = await supabase
      .from("players").select("id, name").eq("name", name).maybeSingle();
    if (!player) return json({ ok: false, error: "no_such_player" }, 404);

    // ── Register a new passkey (needs PIN) ─────────────────────────────────
    if (action === "register-options") {
      if (!(await pinMatches(name, String(body.pin ?? "")))) {
        return json({ ok: false, error: "pin_required" }, 403);
      }
      const existing = await passkeysFor(name);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rp.rpID,
        userName: name,
        userDisplayName: name,
        userID: new TextEncoder().encode(player.id),
        attestationType: "none",
        excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ?? undefined })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",          // forces Face ID / fingerprint
          authenticatorAttachment: "platform",   // this phone, not a USB key
        },
      });
      await saveChallenge(name, "register", options.challenge);
      return json({ ok: true, options });
    }

    if (action === "register-verify") {
      const expectedChallenge = await takeChallenge(name, "register");
      if (!expectedChallenge) return json({ ok: false, error: "challenge_expired" }, 400);
      const verification = await verifyRegistrationResponse({
        // deno-lint-ignore no-explicit-any
        response: body.response as any,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return json({ ok: false, error: "verification_failed" }, 400);
      }
      const { credential } = verification.registrationInfo;
      const { error } = await supabase.from("player_passkeys").upsert({
        id: credential.id,
        player_name: name,
        public_key: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        device_label: String(body.deviceLabel ?? "").slice(0, 80) || null,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    // ── Log in with a passkey ──────────────────────────────────────────────
    if (action === "login-options") {
      const creds = await passkeysFor(name);
      if (!creds.length) return json({ ok: false, error: "no_passkeys" });
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: "required",
        allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports ?? undefined })),
      });
      await saveChallenge(name, "login", options.challenge);
      return json({ ok: true, options });
    }

    if (action === "login-verify") {
      const expectedChallenge = await takeChallenge(name, "login");
      if (!expectedChallenge) return json({ ok: false, error: "challenge_expired" }, 400);
      // deno-lint-ignore no-explicit-any
      const response = body.response as any;
      const creds = await passkeysFor(name);
      const cred = creds.find((c) => c.id === response?.id);
      if (!cred) return json({ ok: false, error: "unknown_passkey" }, 400);
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: {
          id: cred.id,
          publicKey: isoBase64URL.toBuffer(cred.public_key),
          counter: Number(cred.counter),
          transports: cred.transports ?? undefined,
        },
      });
      if (!verification.verified) return json({ ok: false, error: "verification_failed" }, 401);
      await supabase.from("player_passkeys").update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      }).eq("id", cred.id);
      return json({ ok: true });
    }

    // ── Turn Face ID off for this player (needs PIN) ───────────────────────
    if (action === "remove") {
      if (!(await pinMatches(name, String(body.pin ?? "")))) {
        return json({ ok: false, error: "pin_required" }, 403);
      }
      await supabase.from("player_passkeys").delete().eq("player_name", name);
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (err) {
    console.error("passkey-auth error:", err);
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
