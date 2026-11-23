// Face ID / fingerprint login using passkeys (WebAuthn).
// The server side lives in supabase/functions/passkey-auth.
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { supabase } from './supabase';

// Remembers, per device, which player turned Face ID on here. Only a marker:
// the real check is the signed passkey response verified on the server.
const flagKey = (name: string) => `lb_passkey_${name}`;

export function hasPasskeyOnDevice(name: string): boolean {
  try { return !!name && localStorage.getItem(flagKey(name)) === '1'; } catch { return false; }
}

function setPasskeyFlag(name: string, on: boolean) {
  try {
    if (on) localStorage.setItem(flagKey(name), '1');
    else localStorage.removeItem(flagKey(name));
  } catch { /* storage unavailable */ }
}

// Dismissed the "turn on Face ID?" offer on this device.
const offerKey = (name: string) => `lb_passkey_offer_dismissed_${name}`;
export function passkeyOfferDismissed(name: string): boolean {
  try { return localStorage.getItem(offerKey(name)) === '1'; } catch { return true; }
}
export function dismissPasskeyOffer(name: string) {
  try { localStorage.setItem(offerKey(name), '1'); } catch { /* ignore */ }
}

/** True when this phone/computer can do Face ID / Touch ID / fingerprint. */
export async function canUseBiometrics(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try { return await platformAuthenticatorIsAvailable(); } catch { return false; }
}

/** "Face ID" on iPhone/iPad, otherwise a neutral label. */
export function biometricLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'Face ID';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  if (/Android/.test(ua)) return 'fingerprint';
  return 'Face ID';
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('passkey-auth', { body });
  if (error) {
    // Non-2xx responses still carry a JSON body with the reason.
    let reason = 'request_failed';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) reason = (await ctx.json())?.error ?? reason;
    } catch { /* ignore */ }
    return { ok: false, error: reason } as { ok: false; error: string };
  }
  return data as { ok: boolean; error?: string; options?: unknown };
}

function cancelled(e: unknown): boolean {
  const n = (e as { name?: string })?.name;
  return n === 'NotAllowedError' || n === 'AbortError';
}

export type PasskeyResult = { ok: true } | { ok: false; reason: 'cancelled' | 'failed' | 'none'; detail?: string };

// Safari only shows the Face ID sheet right after a tap, and a network call in
// between can use that tap up. So the server challenge is fetched BEFORE the
// tap ("prepare"), and the tap handler goes straight to the Face ID prompt.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PreparedPasskey = { name: string; options: any };

/** Fetch a challenge to turn on Face ID for `name`. Needs their PIN once. */
export async function prepareEnablePasskey(name: string, pin: string): Promise<PreparedPasskey | null> {
  const opts = await call({ action: 'register-options', name, pin });
  return opts.ok && opts.options ? { name, options: opts.options } : null;
}

/** Call from a tap, with the result of prepareEnablePasskey. */
export async function enablePasskey(prep: PreparedPasskey): Promise<PasskeyResult> {
  let response;
  try {
    response = await startRegistration({ optionsJSON: prep.options });
  } catch (e) {
    if ((e as { name?: string })?.name === 'InvalidStateError') {
      // Already registered on this device: just remember it.
      setPasskeyFlag(prep.name, true);
      return { ok: true };
    }
    return { ok: false, reason: cancelled(e) ? 'cancelled' : 'failed', detail: String(e) };
  }
  const deviceLabel = navigator.userAgent.slice(0, 80);
  const res = await call({ action: 'register-verify', name: prep.name, response, deviceLabel });
  if (!res.ok) return { ok: false, reason: 'failed', detail: res.error };
  setPasskeyFlag(prep.name, true);
  return { ok: true };
}

/** Fetch a login challenge for `name`. Null when they have no passkeys. */
export async function prepareLoginPasskey(name: string): Promise<PreparedPasskey | null> {
  const opts = await call({ action: 'login-options', name });
  if (!opts.ok || !opts.options) {
    if (opts.error === 'no_passkeys') setPasskeyFlag(name, false);
    return null;
  }
  return { name, options: opts.options };
}

/** Call from a tap, with the result of prepareLoginPasskey. */
export async function loginWithPasskey(prep: PreparedPasskey): Promise<PasskeyResult> {
  let response;
  try {
    response = await startAuthentication({ optionsJSON: prep.options });
  } catch (e) {
    return { ok: false, reason: cancelled(e) ? 'cancelled' : 'failed', detail: String(e) };
  }
  const res = await call({ action: 'login-verify', name: prep.name, response });
  if (!res.ok) return { ok: false, reason: 'failed', detail: res.error };
  return { ok: true };
}

/** Turn Face ID off on this device only (the PIN keeps working). */
export function disablePasskeyOnDevice(name: string) {
  setPasskeyFlag(name, false);
}
