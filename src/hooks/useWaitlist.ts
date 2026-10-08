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
import { computeWaitlistFrom, type WaitlistResult } from '../lib/waitlist';
import type { Day } from '../types';

export interface UseWaitlistResult extends WaitlistResult {
  // True if this player name (as a member) is in the accepted list.
  isAccepted: (name: string) => boolean;
  // True if this player name (as a member) is in the waitlist.
  isWaitlisted: (name: string) => boolean;
  // Total attendee count (accepted + waitlisted) so callers can display
  // "12/20" style badges without recomputing.
  totalVoters: number;
}

export function useWaitlist(day: Day): UseWaitlistResult {
  const { rsvpData, guestData, rsvpTimestamps } = useApp();

  const result = useMemo(() => {
    const rsvps = rsvpData[day] ?? {};
    const guests = guestData[day] ?? [];
    const timestamps = rsvpTimestamps[day] ?? {};
    // Shared builder: members who voted 'going' (ordered by voted_at) + guests
    // (which sort right after their host). See computeWaitlistFrom.
    return computeWaitlistFrom(rsvps, guests, timestamps);
  }, [rsvpData, guestData, rsvpTimestamps, day]);

  return {
    ...result,
    isAccepted: (name: string) => result.accepted.some(a => !a.isGuest && a.name === name),
    isWaitlisted: (name: string) => result.waitlisted.some(a => !a.isGuest && a.name === name),
    totalVoters: result.accepted.length + result.waitlisted.length,
  };
}
