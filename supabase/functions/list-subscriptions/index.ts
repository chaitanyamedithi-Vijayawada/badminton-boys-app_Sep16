import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const OS_APP_ID = 'd4b596d7-2437-46e4-b883-cf06b43bc590';
const OS_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY') ?? '';

// Read-only. A player is 'reachable' if OneSignal holds at least one device
// record for their player_name tag with invalid_identifier = false (a live push
// token). 'hasAnyRecord' tracks players who have device records but all of them
// are stale/invalid (they subscribed once, then cleared data or revoked perms).
Deno.serve(async () => {
  try {
    if (!OS_API_KEY) return new Response(JSON.stringify({ error: 'no key' }), { status: 500 });

    const reachable = new Set<string>();   // lowercased name -> has a live token
    const anyRecord = new Set<string>();    // lowercased name -> has at least one record
    let offset = 0;
    const limit = 300;
    for (let i = 0; i < 20; i++) {
      const res = await fetch(
        `https://onesignal.com/api/v1/players?app_id=${OS_APP_ID}&limit=${limit}&offset=${offset}`,
        { headers: { 'Authorization': `Basic ${OS_API_KEY}` } },
      );
      if (!res.ok) return new Response(JSON.stringify({ error: res.status, detail: await res.text() }), { status: 502 });
      const json = await res.json();
      const plist: { tags?: Record<string, string>; external_user_id?: string; invalid_identifier?: boolean }[] = json.players ?? [];
      for (const p of plist) {
        const raw = p.tags?.player_name ?? p.external_user_id ?? '';
        if (!raw) continue;
        const key = raw.toLowerCase();
        anyRecord.add(key);
        if (p.invalid_identifier === false) reachable.add(key);
      }
      if (plist.length < limit) break;
      offset += limit;
    }

    const { data: players } = await supabase
      .from('players')
      .select('name')
      .or('archived.is.null,archived.eq.false');

    const all = (players ?? []).map((p: { name: string }) => p.name).sort((a: string, b: string) => a.localeCompare(b));
    const subscribed: string[] = [];
    const expiredOnly: string[] = [];
    const neverRegistered: string[] = [];
    for (const name of all) {
      const key = name.toLowerCase();
      if (reachable.has(key)) subscribed.push(name);
      else if (anyRecord.has(key)) expiredOnly.push(name);
      else neverRegistered.push(name);
    }

    return new Response(JSON.stringify({
      total_active: all.length,
      subscribed_count: subscribed.length,
      not_subscribed_count: expiredOnly.length + neverRegistered.length,
      subscribed,
      not_subscribed: {
        expired_token_only: expiredOnly,
        never_registered: neverRegistered,
      },
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
