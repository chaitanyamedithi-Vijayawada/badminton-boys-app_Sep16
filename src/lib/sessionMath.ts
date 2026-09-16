// ── Session money math ────────────────────────────────────────────────────────
// Pure functions extracted from AppContext.completeSession and
// AppContext.handleUpdateSessionPlayerHours so the club's money math is unit-
// testable. Behavior is intentionally IDENTICAL to the original inline code —
// including the rounding quirk that finalize rounds to 3 decimals while the
// hour-adjustment flow rounds to 2 (both pre-existing).

import { type CourtSplit, courtSplitCourtHours, courtSplitMaxCourts, courtSplitTotalHours } from './constants';

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
export const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Total session cost ────────────────────────────────────────────────────────
// Priority: manual override > split-court segments > flat courts × hours.
// ratePerCourt is the 2-hour rate, so per-hour-per-court is ratePerCourt / 2.
export interface SessionCostInput {
  totalCostOverride?: number | null;
  split: CourtSplit | null;
  courtsCount: number;
  sessionHours: number;
  ratePerCourt: number;
}

export interface SessionCostResult {
  totalCost: number;
  effectiveCourtsCount: number;
  effectiveSessionHours: number;
}

export function computeSessionCost(input: SessionCostInput): SessionCostResult {
  const { totalCostOverride, split, courtsCount, sessionHours, ratePerCourt } = input;
  const perHourPerCourt = ratePerCourt / 2;

  const splitActive = !!split?.enabled && split.segments.length > 0;
  const splitHours = courtSplitCourtHours(split);

  if (totalCostOverride != null) {
    return {
      totalCost: totalCostOverride,
      effectiveCourtsCount: courtsCount,
      effectiveSessionHours: sessionHours,
    };
  }
  if (splitActive && splitHours > 0) {
    return {
      totalCost: splitHours * perHourPerCourt,
      effectiveCourtsCount: courtSplitMaxCourts(split),
      effectiveSessionHours: courtSplitTotalHours(split),
    };
  }
  return {
    totalCost: courtsCount * perHourPerCourt * sessionHours,
    effectiveCourtsCount: courtsCount,
    effectiveSessionHours: sessionHours,
  };
}

// ── Per-person display value ──────────────────────────────────────────────────
// Stored on completed_sessions and used in emails/UI. Rounded to 3 decimals.
export function computePerPerson(totalCost: number, totalPeople: number): number {
  return totalPeople > 0 ? round3(totalCost / totalPeople) : 0;
}

// ── Finalize-time ledger charges (player-hours model) ─────────────────────────
// total hours = Σ each going player's hours (default 2) + guests × 2 (guests
// are always billed as 2h at finalize). ratePerHour = totalCost / totalHours.
// Each player is charged own-hours × rate; each guest's 2h × rate is charged
// to their host. Amounts rounded to 3 decimals (matches original code).
export interface GuestLike {
  name: string;
  brought_by?: string | null;
}

export interface FinalizeChargesInput {
  goingPlayers: string[];
  guests: GuestLike[];
  hoursMap: Record<string, number>; // per-player RSVP hours; absent → 2
  totalCost: number;
}

export interface FinalizeChargesResult {
  totalPlayerHours: number;
  ratePerHour: number;
  /** Positive amounts — callers negate when inserting ledger rows. */
  playerCharges: { name: string; amount: number }[];
  guestCharges: { host: string; guest: string; amount: number }[];
}

export function computeFinalizeCharges(input: FinalizeChargesInput): FinalizeChargesResult {
  const { goingPlayers, guests, hoursMap, totalCost } = input;

  const totalPlayerHours =
    goingPlayers.reduce((sum, n) => sum + (hoursMap[n] ?? 2), 0) + guests.length * 2;
  const ratePerHour = totalPlayerHours > 0 ? totalCost / totalPlayerHours : 0;

  const playerCharges = goingPlayers.map(name => ({
    name,
    amount: round3((hoursMap[name] ?? 2) * ratePerHour),
  }));

  const guestCharges = guests
    .filter(g => !!g.brought_by)
    .map(g => ({
      host: g.brought_by as string,
      guest: g.name,
      amount: round3(2 * ratePerHour),
    }));

  return { totalPlayerHours, ratePerHour, playerCharges, guestCharges };
}

// ── Hour-adjustment recalculation ─────────────────────────────────────────────
// Mirrors handleUpdateSessionPlayerHours: hours default to sessionHours (NOT a
// flat 2), guests' hours are folded into their host's single charge, and the
// result is rounded to 2 decimals. Returns null when total hours is 0 (the
// original shows a toast and aborts in that case).
export interface AdjustedChargesInput {
  players: string[];
  guests: GuestLike[];
  playerHours: Record<string, number>; // overrides only; absent → sessionHours
  sessionHours: number;
  totalCost: number;
}

export interface AdjustedChargesResult {
  totalPlayerHours: number;
  ratePerHour: number;
  /** Positive amounts, one per named player, guests folded into host. */
  playerCharges: { name: string; amount: number }[];
}

export function computeAdjustedCharges(input: AdjustedChargesInput): AdjustedChargesResult | null {
  const { players, guests, playerHours, sessionHours, totalCost } = input;
  const getHours = (name: string) => playerHours[name] ?? sessionHours;

  const allNames = [...players, ...guests.map(g => g.name)];
  const totalPlayerHours = allNames.reduce((sum, n) => sum + getHours(n), 0);
  if (totalPlayerHours === 0) return null;

  const ratePerHour = totalCost / totalPlayerHours;

  const playerCharges = players.map(name => {
    const ownHours = getHours(name);
    const guestHours = guests
      .filter(g => g.brought_by === name)
      .reduce((sum, g) => sum + getHours(g.name), 0);
    return { name, amount: round2((ownHours + guestHours) * ratePerHour) };
  });

  return { totalPlayerHours, ratePerHour, playerCharges };
}
