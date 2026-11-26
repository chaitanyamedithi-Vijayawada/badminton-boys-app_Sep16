// ── Add-to-calendar helpers ──────────────────────────────────────────────────
// Builds a Google Calendar link and an .ics file for a session. Times are the
// club's wall-clock times in Pacific time; both outputs carry the
// America/Vancouver zone so they land correctly on any device.

export const CLUB_TZ = 'America/Vancouver';
const APP_URL = 'https://badmintonboys.net';

export interface CalendarEvent {
  uid: string;          // stable per session, so re-adding updates instead of duplicating
  title: string;
  date: string;         // YYYY-MM-DD (Pacific wall date)
  start: string;        // "7:00 AM", "19:00", "7:30pm"
  end: string;
  description?: string;
}

/** Parse "7:00 AM", "7 pm", "19:30" → { h, m } in 24h, or null. */
export function parseClockTime(input: string): { h: number; m: number } | null {
  const s = input.trim().toLowerCase();
  const match = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  const ampm = match[3];
  if (m > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return { h, m };
}

/** Split a "7:00 AM – 9:00 AM" style range into its two ends. */
export function splitTimeRange(range: string): { start: string; end: string } | null {
  const parts = range.split(/\s*[–—-]\s*/);
  if (parts.length !== 2) return null;
  return { start: parts[0], end: parts[1] };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-28" + "7:00 AM" → "20261128T070000" (local, no zone). */
function localStamp(date: string, time: string): string | null {
  const t = parseClockTime(time);
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!t || !d) return null;
  return `${d[1]}${d[2]}${d[3]}T${pad(t.h)}${pad(t.m)}00`;
}

/** Event end is on the next day when it is not after the start (e.g. 22:00–00:30). */
function endStamp(ev: CalendarEvent): string | null {
  const s = parseClockTime(ev.start);
  const e = parseClockTime(ev.end);
  if (!s || !e) return null;
  let date = ev.date;
  if (e.h * 60 + e.m <= s.h * 60 + s.m) {
    const [y, m, d] = ev.date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    date = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  }
  return localStamp(date, ev.end);
}

export function googleCalendarUrl(ev: CalendarEvent): string | null {
  const start = localStamp(ev.date, ev.start);
  const end = endStamp(ev);
  if (!start || !end) return null;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${start}/${end}`,
    ctz: CLUB_TZ,
    details: `${ev.description ? ev.description + '\n\n' : ''}${APP_URL}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escape text for an iCalendar TEXT value. */
function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

// Pacific time rules (US/Canada since 2007): DST from the 2nd Sunday of March
// to the 1st Sunday of November. Included so strict clients resolve TZID.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${CLUB_TZ}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

export function buildIcs(ev: CalendarEvent, now: Date = new Date()): string | null {
  const start = localStamp(ev.date, ev.start);
  const end = endStamp(ev);
  if (!start || !end) return null;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const desc = `${ev.description ? ev.description + '\n\n' : ''}${APP_URL}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CourtCrew//Badminton Boys//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${ev.uid}@badmintonboys.net`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${CLUB_TZ}:${start}`,
    `DTEND;TZID=${CLUB_TZ}:${end}`,
    `SUMMARY:${icsText(ev.title)}`,
    `DESCRIPTION:${icsText(desc)}`,
    `URL:${APP_URL}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(ev.title)}`,
    'TRIGGER:-PT60M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Hand the .ics to the device: share sheet where available, else download. */
export async function openIcs(ev: CalendarEvent): Promise<boolean> {
  const ics = buildIcs(ev);
  if (!ics) return false;
  const fileName = `${ev.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'session'}.ics`;
  const file = new File([ics], fileName, { type: 'text/calendar' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: ev.title });
      return true;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return true; // user closed the sheet
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
