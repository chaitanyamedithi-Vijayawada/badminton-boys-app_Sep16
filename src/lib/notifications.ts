const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const OS_APP_ID = 'd4b596d7-2437-46e4-b883-cf06b43bc590';

async function sendPush(title: string, message: string, adminOnly = false) {
  try {
    const body: Record<string, unknown> = {
      app_id: OS_APP_ID,
      headings: { en: title },
      contents: { en: message },
      url: 'https://langleybadmintonboys.netlify.app',
    };

    if (adminOnly) {
      body.filters = [{ field: 'tag', key: 'is_admin', relation: '=', value: 'true' }];
    } else {
      body.included_segments = ['All'];
    }

    await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.log('Push error:', e);
  }
}

export async function notifyRsvp(playerName: string, day: string, status: 'going' | 'skip', totalGoing: number) {
  const dayLabel = day === 'saturday' ? 'Saturday' : 'Wednesday';
  if (status === 'going') {
    await sendPush(
      `🏸 ${playerName} is joining ${dayLabel}!`,
      `${totalGoing} player${totalGoing !== 1 ? 's' : ''} going so far`,
      true
    );
  } else {
    await sendPush(
      `❌ ${playerName} cancelled for ${dayLabel}`,
      `${totalGoing} player${totalGoing !== 1 ? 's' : ''} still going`,
      true
    );
  }
}

export async function notifyBroadcast(message: string, sentBy: string) {
  await sendPush(`📢 ${sentBy}`, message);
}

export async function notifySessionComplete(params: {
  day: string;
  week: string;
  perPerson: number;
  totalCost: number;
  courtsCount: number;
  players: { name: string; oldBalance: number; newBalance: number; guestCount?: number }[];
}) {
  const dayLabel = params.day.charAt(0).toUpperCase() + params.day.slice(1);
  const totalCount = params.players.length;
  const fmt = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);

  const promises = params.players.map(p => {
    const guestNote = p.guestCount ? ` +${p.guestCount} guest` : '';
    const deducted = p.oldBalance - p.newBalance;
    const body = `−$${deducted.toFixed(2)}${guestNote} | ${fmt(p.oldBalance)} → ${fmt(p.newBalance)} | ${totalCount} players, ${params.courtsCount} court${params.courtsCount !== 1 ? 's' : ''}`;
    return fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        headings: { en: `🏸 ${dayLabel} session done!` },
        contents: { en: body },
        filters: [{ field: 'tag', key: 'player_name', relation: '=', value: p.name }],
      }),
    }).catch(() => {});
  });

  await Promise.all(promises);
}

export async function sendSessionEmail(params: {
  day: string;
  week: string;
  sessionDate: string;
  sessionTime: string;
  hoursPlayed: number;
  courtsCount: number;
  playersCount: number;
  perPerson: number;
  allPlayerNames: string[];
  players: { name: string; email: string; oldBalance: number; newBalance: number; guestCount: number }[];
}): Promise<{ sent: number; failed: number; eligible: number }> {
  const withEmail = params.players.filter(p => p.email);
  let sent = 0;
  let failed = 0;

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  // Resend's free tier allows only 5 requests/second. Sending every email at
  // once (Promise.all) tripped that limit (429 "rate_limit_exceeded") and only
  // the first ~5 got through. Instead we send in small bursts with a pause
  // between them, and retry any that still come back rate-limited.
  const CHUNK_SIZE = 4;     // emails per burst (kept under the 5/sec cap)
  const GAP_MS = 1200;      // pause between bursts
  const MAX_PASSES = 3;     // retry rate-limited ones a few times

  type SessionPlayer = (typeof withEmail)[number];

  // Sends one email. Returns 'ok' | 'rate' (hit the rate limit) | 'fail'.
  const postOne = async (p: SessionPlayer): Promise<'ok' | 'rate' | 'fail'> => {
    const totalDeducted = (1 + p.guestCount) * params.perPerson;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          type: 'session',
          to: p.email,
          playerName: p.name,
          day: params.day,
          week: params.week,
          sessionDate: params.sessionDate,
          sessionTime: params.sessionTime,
          hoursPlayed: params.hoursPlayed,
          courtsCount: params.courtsCount,
          playersCount: params.playersCount,
          perPerson: params.perPerson,
          guestCount: p.guestCount,
          totalDeducted,
          oldBalance: p.oldBalance,
          newBalance: p.newBalance,
          allPlayers: params.allPlayerNames,
        }),
      });
      if (res.ok) return 'ok';
      const err = await res.json().catch(() => ({})) as {
        name?: string; statusCode?: number;
        detail?: { name?: string; statusCode?: number };
      };
      // send-email surfaces a Resend 429 as a 502 with the detail attached.
      const isRate =
        res.status === 429 ||
        err?.statusCode === 429 || err?.name === 'rate_limit_exceeded' ||
        err?.detail?.statusCode === 429 || err?.detail?.name === 'rate_limit_exceeded';
      if (isRate) { console.warn('sendSessionEmail rate-limited for', p.name); return 'rate'; }
      console.warn('sendSessionEmail failed for', p.name, res.status, err);
      return 'fail';
    } catch (e) {
      console.warn('sendSessionEmail error for', p.name, e);
      return 'fail';
    }
  };

  // Sends a queue in throttled bursts; returns the ones that were rate-limited.
  const runQueue = async (queue: SessionPlayer[]): Promise<SessionPlayer[]> => {
    const rateLimited: SessionPlayer[] = [];
    for (let i = 0; i < queue.length; i += CHUNK_SIZE) {
      const batch = queue.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(batch.map(postOne));
      results.forEach((r, idx) => {
        if (r === 'ok') sent++;
        else if (r === 'fail') failed++;
        else rateLimited.push(batch[idx]);
      });
      if (i + CHUNK_SIZE < queue.length) await sleep(GAP_MS);
    }
    return rateLimited;
  };

  let queue = withEmail;
  for (let pass = 0; pass < MAX_PASSES && queue.length > 0; pass++) {
    if (pass > 0) await sleep(GAP_MS * 2); // back off before retrying
    queue = await runQueue(queue);
  }
  // Anything still rate-limited after all retries counts as failed.
  queue.forEach(p => console.warn('sendSessionEmail gave up (rate limit) for', p.name));
  failed += queue.length;

  return { sent, failed, eligible: withEmail.length };
}

export function registerPlayerForNotifications(playerName: string, adminNames: string[]) {
  const w = window as Window & { OneSignalDeferred?: ((os: OneSignalInstance) => Promise<void>)[] };
  if (!w.OneSignalDeferred) return;
  w.OneSignalDeferred.push(async (OneSignal: OneSignalInstance) => {
    try {
      await OneSignal.login(playerName);
      await OneSignal.User.addTag('player_name', playerName);
      await OneSignal.User.addTag('is_admin', adminNames.includes(playerName) ? 'true' : 'false');
    } catch (e) {
      console.log('OneSignal register error:', e);
    }
  });
}

interface OneSignalInstance {
  login(id: string): Promise<void>;
  User: { addTag(key: string, value: string): Promise<void> };
}

export async function notifyTransferSubmitted(playerName: string, amount: number) {
  await sendPush(
    '💸 Payment Notification',
    `${playerName} sent $${amount.toFixed(2)} via Interac — please confirm`,
    true
  );
}

export async function notifyTopUpConfirmed(params: {
  to: string;
  playerName: string;
  amount: number;
  oldBalance: number;
  newBalance: number;
  confirmedBy: string;
  note?: string;
}): Promise<boolean> {
  console.log('notifyTopUpConfirmed called for:', params.playerName, params.to);
  if (!params.to) {
    console.warn('notifyTopUpConfirmed: no email address, skipping');
    return false;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        type: 'topup',
        to: params.to,
        playerName: params.playerName,
        amount: params.amount,
        oldBalance: params.oldBalance,
        newBalance: params.newBalance,
        confirmedBy: params.confirmedBy,
        note: params.note,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('notifyTopUpConfirmed failed:', res.status, err);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('notifyTopUpConfirmed error:', e);
    return false;
  }
}