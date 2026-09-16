import type { Day } from '../types';

const PACIFIC_TZ = 'America/Vancouver';

let serverOffsetMs = 0;
let offsetFetched = false;

export async function fetchServerTimeOffset(): Promise<void> {
  if (offsetFetched) return;
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/server-time`;
    const res = await fetch(url);
    if (!res.ok) return;
    const { iso } = await res.json();
    const serverNow = new Date(iso).getTime();
    const clientNow = Date.now();
    serverOffsetMs = serverNow - clientNow;
    offsetFetched = true;
  } catch {
    serverOffsetMs = 0;
  }
}

function getNowPacific(): Date {
  const trustedNow = new Date(Date.now() + serverOffsetMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(trustedNow);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  return new Date(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(hour), Number(map.minute), Number(map.second)
  );
}

export function getPacificNow(): Date {
  return getNowPacific();
}

function formatYMD(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getCurrentWeekKey(): string {
  const now = getNowPacific();
  const dow = now.getDay();
  const sat = new Date(now);
  sat.setHours(0, 0, 0, 0);
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  sat.setDate(sat.getDate() + mondayOffset + 5);
  return formatYMD(sat);
}

export function getCurrentWeekRange(): { start: string; end: string } {
  const now = getNowPacific();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatYMD(monday), end: formatYMD(sunday) };
}

function getCurrentSessionDate(day: Day): Date {
  const now = getNowPacific();
  const dow = now.getDay();
  const session = new Date(now);
  session.setHours(0, 0, 0, 0);

  const daysUntilSat = (6 - dow + 7) % 7;
  session.setDate(session.getDate() + daysUntilSat);

  if (day === 'saturday') return session;

  // Wednesday is 3 days before Saturday.
  const wed = new Date(session);
  wed.setDate(session.getDate() - 3);
  return wed;
}

function getNextSessionDate(day: Day): Date {
  return getCurrentSessionDate(day);
}

function getCutoffDate(day: Day): Date {
  const session = getNextSessionDate(day);
  const cutoff = new Date(session);
  if (day === 'saturday') {
    cutoff.setDate(session.getDate() - 2); // Thursday
    cutoff.setHours(21, 0, 0, 0);          // 9:00 PM
  } else {
    cutoff.setDate(session.getDate() - 1); // Wednesday
    cutoff.setHours(17, 0, 0, 0);          // 5:00 PM
  }
  return cutoff;
}

export function isSessionEndPassed(day: Day, satEndHour = 9, wedEndHour = 20): boolean {
  const now = getNowPacific();
  const sessionDate = getCurrentSessionDate(day);
  const sessionEnd = new Date(sessionDate);
  sessionEnd.setHours(day === 'saturday' ? satEndHour : wedEndHour, 0, 0, 0);
  return now.getTime() >= sessionEnd.getTime();
}

export function isExtraSessionEnded(sessionDate: string, endTime: string): boolean {
  const now = getNowPacific();
  const [y, mo, d] = sessionDate.split('-').map(Number);
  const [h, mi] = endTime.split(':').map(Number);
  const nowWall = now.getFullYear() * 100000000 + (now.getMonth() + 1) * 1000000
    + now.getDate() * 10000 + now.getHours() * 100 + now.getMinutes();
  const endWall = y * 100000000 + mo * 1000000 + d * 10000 + h * 100 + mi;
  return nowWall > endWall;
}

export function isExtraCutoffPassed(cutoffTime: string): boolean {
  const now = getNowPacific();
  const cutoff = new Date(cutoffTime);
  if (isNaN(cutoff.getTime())) return false;
  const nowWall = now.getFullYear() * 100000000 + (now.getMonth() + 1) * 1000000
    + now.getDate() * 10000 + now.getHours() * 100 + now.getMinutes();
  const cutoffWall = cutoff.getFullYear() * 100000000 + (cutoff.getMonth() + 1) * 1000000
    + cutoff.getDate() * 10000 + cutoff.getHours() * 100 + cutoff.getMinutes();
  return nowWall > cutoffWall;
}

export function isVotingClosed(day: Day, satStartHour = 7, wedStartHour = 18): boolean {
  const now = getNowPacific();
  const session = getNextSessionDate(day);
  const startHour = day === 'saturday' ? satStartHour : wedStartHour;
  const sessionStart = new Date(session);
  sessionStart.setHours(startHour, 0, 0, 0);
  const msUntilStart = sessionStart.getTime() - now.getTime();
  return msUntilStart <= 24 * 60 * 60 * 1000;
}

// Voting-window gates.
// Voting for the next session opens at 4:00 AM Pacific on the day AFTER the
// most recent session of that type. Between session-end and 4 AM, the tab
// shows the just-completed session's recap instead of active RSVP.
//   - Saturday session (Sat morning) → voting opens Sunday 4 AM
//   - Wednesday session (Wed 6-8 PM) → voting opens Thursday 4 AM
const VOTING_OPEN_HOUR = 4;   // 4 AM Pacific

export function isSaturdayVotingOpen(): boolean {
  const now = getNowPacific();
  const dow = now.getDay();      // 0=Sun … 6=Sat
  if (dow === 6) return false;
  if (dow === 0 && now.getHours() < VOTING_OPEN_HOUR) return false;
  return true;
}

export function isWednesdayVotingOpen(): boolean {
  const now = getNowPacific();
  const dow = now.getDay();      // 0=Sun … 6=Sat
  if (dow === 3) return false;
  if (dow === 4 && now.getHours() < VOTING_OPEN_HOUR) return false;
  return true;
}

export function isCutoffPassed(day: Day): boolean {
  const now = getNowPacific();
  return now > getCutoffDate(day);
}

export function getCutoffInfo(day: Day): { passed: boolean; label: string; deadline: string } {
  const passed = isCutoffPassed(day);
  const dayName = day === 'saturday' ? 'Thursday' : 'Tuesday';
  const time = day === 'saturday' ? '9:00 PM' : '5:00 PM';
  const deadline = `${dayName} ${time}`;
  const label = passed
    ? `Withdraw cutoff passed (${deadline}) — you can still join!`
    : `Withdraw by ${deadline} · After this you cannot cancel`;
  return { passed, label, deadline };
}

export function getCutoffLabel(day: Day): string {
  return getCutoffInfo(day).label;
}

export function minutesSinceSessionEnd(day: Day, satEndHour = 9, wedEndHour = 20): number {
  const now = getNowPacific();
  const dow = now.getDay();
  const targetDow = day === 'saturday' ? 6 : 3;
  const endHour = day === 'saturday' ? satEndHour : wedEndHour;
  const daysSince = (dow - targetDow + 7) % 7;
  const lastSession = new Date(now);
  lastSession.setDate(now.getDate() - daysSince);
  lastSession.setHours(endHour, 0, 0, 0);
  if (lastSession.getTime() > now.getTime()) {
    lastSession.setDate(lastSession.getDate() - 7);
  }
  return Math.floor((now.getTime() - lastSession.getTime()) / 60000);
}
