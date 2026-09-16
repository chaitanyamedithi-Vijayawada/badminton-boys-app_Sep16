// src/hooks/useWaitlist.ts
//
// React hook that computes the accepted/waitlisted split for a given day
// (saturday or wednesday). Pulls RSVPs, guests, and voted-at timestamps from
// AppContext and feeds them into `computeWaitlist`.
//
// Usage:
//   const { accepted, waitlisted, courtsOpen, capacity, isAccepted } = useWaitlist('saturday');
//   const myState = isAccepted('Chaitanya') ? 'in' : (isWaitlisted('Chaitanya') ? 'waiting' : 'not going');

import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { computeWaitlist, type Attendee, type WaitlistResult } from '../lib/waitlist';
import type { Day } from '../types';

export interface UseWaitlistResult extends WaitlistResult {
  // True if this player name (as a member) is in the accepted list.
  isAccepted: (name: string) => boolean;
  // True if this player name (as a member) is in the waitlist.
  isWaitlisted: (name: string) => boolean;
  // Total attendee count (accepted + waitlisted) so callers can display
  // "12/20" style badges without recomputing
  totalVoters: number;
}

export function useWaitlist(day: Day): UseWaitlistResult {
  const { rsvpData, guestData, rsvpTimestamps } = useApp();

  const result = useMemo(() => {
    const rsvps = rsvpData[day] ?? {};
    const guests = guestData[day] ?? [];
    const timestamps = rsvpTimestamps[day] ?? {};

    // Members who voted 'going'. Their voted_at drives ordering.
    const memberAttendees: Attendee[] = Object.entries(rsvps)
      .filter(([, s]) => s === 'going')
      .map(([name]) => ({
        name,
        isGuest: false,
        votedAt: timestamps[name] || '',
      }));

    // Guests inherit their host's voted_at plus a tiny suffix so they sort
    // right AFTER their host (not before), preserving the intent that "host
    // votes → their guest is with them". This keeps hosts from being pushed
    // to waitlist by their own guests.
    const guestAttendees: Attendee[] = guests.map(g => ({
      name: g.name,
      isGuest: true,
      broughtBy: g.brought_by,
      votedAt: (g.brought_by ? (timestamps[g.brought_by] || '') : '') + '~guest',
    }));

    return computeWaitlist([...memberAttendees, ...guestAttendees]);
  }, [rsvpData, guestData, rsvpTimestamps, day]);

  return {
    ...result,
    isAccepted: (name: string) => result.accepted.some(a => !a.isGuest && a.name === name),
    isWaitlisted: (name: string) => result.waitlisted.some(a => !a.isGuest && a.name === name),
    totalVoters: result.accepted.length + result.waitlisted.length,
  };
}
