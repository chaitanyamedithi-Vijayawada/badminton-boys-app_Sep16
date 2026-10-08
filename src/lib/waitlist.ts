// src/lib/waitlist.ts
//
// Waitlist calculation for regular Sat/Tue sessions.
//
// Rule:
//   - The venue caps at 4 courts.
//   - A court opens at every 4th voter (voter #4 opens court 1, #8 opens
//     court 2, #12 opens court 3, #16 opens court 4).
//   - Each open court accepts up to 5 attendees (4 base + 1 rotation extra).
//     So capacity is: courts × 5, up to a max of 20 accepted attendees.
//   - Attendees are considered in the order they voted (earliest voted_at wins).
//     Guests are attributed to their host's voted_at time, so they slot in
//     right after their host in the ordering.
//   - Everyone beyond capacity goes on the waitlist, in the same time order.
//
// This is a **derived** view — the DB still stores every voter as
// status='going'. The waitlist is computed on the client from the ordering,
// so no schema changes are required.

export const MAX_COURTS = 4;
export const BASE_PER_COURT = 4;   // 4 base players per court
export const EXTRA_PER_COURT = 1;  // 1 extra rotation slot per court

// How many attendees fit given N open courts.
export function capacityFor(courts: number): number {
  return courts * (BASE_PER_COURT + EXTRA_PER_COURT); // = 5 per court
}

// How many courts open at a given total-voter count.
// One court per every 4 voters, capped at MAX_COURTS.
export function courtsOpenFor(totalVoters: number): number {
  const courts = Math.floor(totalVoters / BASE_PER_COURT);
  return Math.min(Math.max(0, courts), MAX_COURTS);
}

export interface Attendee {
  name: string;                 // display name (player name, or guest label)
  isGuest: boolean;
  broughtBy?: string;           // host name, only for guests
  votedAt: string;              // ISO timestamp used for ordering
}

export interface WaitlistResult {
  courtsOpen: number;
  capacity: number;
  accepted: Attendee[];
  waitlisted: Attendee[];
}

// Compute accepted vs waitlisted for a session's attendee list.
// The caller assembles the Attendee[] from RSVPs (going only) + guests.
export function computeWaitlist(attendees: Attendee[]): WaitlistResult {
  // Order attendees by voted_at ascending. Missing timestamps sort to the end
  // (they voted before timestamps existed — treat as "unknown late").
  const ordered = [...attendees].sort((a, b) => {
    const ta = a.votedAt || '\uffff';
    const tb = b.votedAt || '\uffff';
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });

  const total = ordered.length;
  const courtsOpen = courtsOpenFor(total);
  const capacity = capacityFor(courtsOpen);

  // Clamp capacity — if we have more voters than 4 courts × 5 = 20, extras
  // waitlist. If we have fewer voters than capacity, everyone is accepted.
  const acceptedCount = Math.min(total, capacity);

  return {
    courtsOpen,
    capacity,
    accepted: ordered.slice(0, acceptedCount),
    waitlisted: ordered.slice(acceptedCount),
  };
}

// Build the attendee list from raw RSVPs + guests + voted-at timestamps and
// compute the waitlist. Shared by useWaitlist (live view) and the promotion
// detection in HomeTab, so both use identical ordering rules.
export function computeWaitlistFrom(
  rsvps: Record<string, 'going' | 'skip'>,
  guests: { name: string; brought_by?: string }[],
  timestamps: Record<string, string>,
): WaitlistResult {
  const memberAttendees: Attendee[] = Object.entries(rsvps)
    .filter(([, s]) => s === 'going')
    .map(([name]) => ({ name, isGuest: false, votedAt: timestamps[name] || '' }));
  const guestAttendees: Attendee[] = guests.map(g => ({
    name: g.name,
    isGuest: true,
    broughtBy: g.brought_by,
    votedAt: (g.brought_by ? (timestamps[g.brought_by] || '') : '') + '~guest',
  }));
  return computeWaitlist([...memberAttendees, ...guestAttendees]);
}

// Member names that moved from waitlisted (before) to accepted (after) — i.e.
// got promoted when a spot opened. Guests are ignored (we only notify members).
export function newlyPromoted(before: WaitlistResult, after: WaitlistResult): string[] {
  const wasWaitlisted = new Set(before.waitlisted.filter(a => !a.isGuest).map(a => a.name));
  return after.accepted
    .filter(a => !a.isGuest && wasWaitlisted.has(a.name))
    .map(a => a.name);
}

// Member names that moved from accepted (before) to waitlisted (after) — i.e.
// got bumped when a court closed (total dropped below a court threshold) or
// guests pushed them down the order. Guests are ignored (we only notify members).
export function newlyDemoted(before: WaitlistResult, after: WaitlistResult): string[] {
  const wasAccepted = new Set(before.accepted.filter(a => !a.isGuest).map(a => a.name));
  return after.waitlisted
    .filter(a => !a.isGuest && wasAccepted.has(a.name))
    .map(a => a.name);
}

// Utility: split a WaitlistResult into player names vs guest info for callers
// that need them separately (e.g. cost calculation, match scheduler).
export function splitAttendees(list: Attendee[]): {
  playerNames: string[];
  guests: { name: string; broughtBy: string }[];
} {
  const playerNames: string[] = [];
  const guests: { name: string; broughtBy: string }[] = [];
  for (const a of list) {
    if (a.isGuest) guests.push({ name: a.name, broughtBy: a.broughtBy || '' });
    else playerNames.push(a.name);
  }
  return { playerNames, guests };
}
