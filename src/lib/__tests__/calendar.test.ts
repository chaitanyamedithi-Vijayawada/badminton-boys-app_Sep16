import { describe, it, expect } from 'vitest';
import { parseClockTime, splitTimeRange, googleCalendarUrl, buildIcs } from '../calendar';

describe('parseClockTime', () => {
  it('reads 12-hour times', () => {
    expect(parseClockTime('7:00 AM')).toEqual({ h: 7, m: 0 });
    expect(parseClockTime('6:30 pm')).toEqual({ h: 18, m: 30 });
    expect(parseClockTime('12:00 AM')).toEqual({ h: 0, m: 0 });
    expect(parseClockTime('12:15 PM')).toEqual({ h: 12, m: 15 });
    expect(parseClockTime('7pm')).toEqual({ h: 19, m: 0 });
  });
  it('reads 24-hour times', () => {
    expect(parseClockTime('19:30')).toEqual({ h: 19, m: 30 });
    expect(parseClockTime('07:05')).toEqual({ h: 7, m: 5 });
  });
  it('rejects nonsense', () => {
    expect(parseClockTime('25:00')).toBeNull();
    expect(parseClockTime('13:00 PM')).toBeNull();
    expect(parseClockTime('soon')).toBeNull();
  });
});

describe('splitTimeRange', () => {
  it('splits en-dash and hyphen ranges', () => {
    expect(splitTimeRange('7:00 AM – 9:00 AM')).toEqual({ start: '7:00 AM', end: '9:00 AM' });
    expect(splitTimeRange('18:00-20:00')).toEqual({ start: '18:00', end: '20:00' });
  });
  it('returns null for a single time', () => {
    expect(splitTimeRange('7:00 AM')).toBeNull();
  });
});

const ev = {
  uid: 'regular-saturday-2026-11-28',
  title: 'Badminton Boys, Saturday',
  date: '2026-11-28',
  start: '7:00 AM',
  end: '9:00 AM',
};

describe('googleCalendarUrl', () => {
  it('uses Pacific wall time with the club time zone', () => {
    const url = new URL(googleCalendarUrl(ev)!);
    expect(url.searchParams.get('dates')).toBe('20261128T070000/20261128T090000');
    expect(url.searchParams.get('ctz')).toBe('America/Vancouver');
    expect(url.searchParams.get('text')).toBe(ev.title);
  });
  it('rolls the end to the next day when it passes midnight', () => {
    const url = new URL(googleCalendarUrl({ ...ev, start: '22:00', end: '00:30' })!);
    expect(url.searchParams.get('dates')).toBe('20261128T220000/20261129T003000');
  });
  it('returns null when times cannot be read', () => {
    expect(googleCalendarUrl({ ...ev, start: 'tbd' })).toBeNull();
  });
});

describe('buildIcs', () => {
  it('builds a valid event in the club time zone', () => {
    const ics = buildIcs(ev, new Date('2026-11-26T20:00:00Z'))!;
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;TZID=America/Vancouver:20261128T070000');
    expect(ics).toContain('DTEND;TZID=America/Vancouver:20261128T090000');
    expect(ics).toContain('UID:regular-saturday-2026-11-28@badmintonboys.net');
    expect(ics).toContain('DTSTAMP:20261126T200000Z');
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics.split('\r\n').every(l => !l.includes('\n'))).toBe(true);
  });
  it('escapes commas and semicolons in text', () => {
    const ics = buildIcs({ ...ev, title: 'Doubles, mixed; fun' })!;
    expect(ics).toContain('SUMMARY:Doubles\\, mixed\\; fun');
  });
});
