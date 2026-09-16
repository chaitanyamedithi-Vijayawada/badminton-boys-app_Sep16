import { describe, it, expect } from 'vitest';
import {
  computeSessionCost,
  computePerPerson,
  computeFinalizeCharges,
  computeAdjustedCharges,
  round2,
  round3,
} from '../sessionMath';
import type { CourtSplit } from '../constants';

// Club defaults: ratePerCourt is the 2-hour rate ($44 → $22/court-hour).
const RATE = 44;

describe('computeSessionCost', () => {
  it('flat: courts × hours × (rate/2)', () => {
    const r = computeSessionCost({ split: null, courtsCount: 3, sessionHours: 2, ratePerCourt: RATE });
    expect(r.totalCost).toBe(3 * 2 * 22); // 132
    expect(r.effectiveCourtsCount).toBe(3);
    expect(r.effectiveSessionHours).toBe(2);
  });

  it('split-court: sums court-hours across segments (3×1h + 4×1h = 7)', () => {
    const split: CourtSplit = { enabled: true, segments: [{ courts: 3, hours: 1 }, { courts: 4, hours: 1 }] };
    const r = computeSessionCost({ split, courtsCount: 3, sessionHours: 2, ratePerCourt: RATE });
    expect(r.totalCost).toBe(7 * 22); // 154
    expect(r.effectiveCourtsCount).toBe(4); // max courts in any segment
    expect(r.effectiveSessionHours).toBe(2); // 1 + 1 wall-clock hours
  });

  it('manual override beats everything, including an enabled split', () => {
    const split: CourtSplit = { enabled: true, segments: [{ courts: 3, hours: 1 }] };
    const r = computeSessionCost({ totalCostOverride: 100, split, courtsCount: 3, sessionHours: 2, ratePerCourt: RATE });
    expect(r.totalCost).toBe(100);
    expect(r.effectiveCourtsCount).toBe(3); // override keeps raw courts/hours
    expect(r.effectiveSessionHours).toBe(2);
  });

  it('disabled split falls back to flat', () => {
    const split: CourtSplit = { enabled: false, segments: [{ courts: 5, hours: 5 }] };
    const r = computeSessionCost({ split, courtsCount: 2, sessionHours: 2, ratePerCourt: RATE });
    expect(r.totalCost).toBe(2 * 2 * 22);
  });

  it('admin 1-hour session halves the flat cost', () => {
    const r = computeSessionCost({ split: null, courtsCount: 3, sessionHours: 1, ratePerCourt: RATE });
    expect(r.totalCost).toBe(3 * 22);
  });
});

describe('computePerPerson', () => {
  it('divides and rounds to 3 decimals', () => {
    expect(computePerPerson(132, 16)).toBe(8.25);
    expect(computePerPerson(100, 3)).toBe(33.333);
  });

  it('returns 0 for zero people (no division by zero)', () => {
    expect(computePerPerson(132, 0)).toBe(0);
  });
});

describe('computeFinalizeCharges', () => {
  it('everyone at default 2h splits the cost evenly', () => {
    const r = computeFinalizeCharges({
      goingPlayers: ['A', 'B', 'C', 'D'],
      guests: [],
      hoursMap: {},
      totalCost: 88,
    });
    expect(r.totalPlayerHours).toBe(8);
    expect(r.ratePerHour).toBe(11);
    r.playerCharges.forEach(c => expect(c.amount).toBe(22));
  });

  it('a 1-hour player pays half of a 2-hour player', () => {
    const r = computeFinalizeCharges({
      goingPlayers: ['A', 'B', 'C'],
      guests: [],
      hoursMap: { A: 1 },
      totalCost: 110, // 1 + 2 + 2 = 5 hours → $22/h
    });
    const byName = Object.fromEntries(r.playerCharges.map(c => [c.name, c.amount]));
    expect(byName.A).toBe(22);
    expect(byName.B).toBe(44);
    expect(byName.C).toBe(44);
  });

  it('guests are billed 2h each to their host', () => {
    const r = computeFinalizeCharges({
      goingPlayers: ['A', 'B'],
      guests: [{ name: 'G1', brought_by: 'A' }],
      hoursMap: {},
      totalCost: 132, // 2+2+2 = 6h → $22/h
    });
    expect(r.guestCharges).toEqual([{ host: 'A', guest: 'G1', amount: 44 }]);
    // A pays own 44 + guest 44 across two ledger rows; B pays 44
  });

  it('guests without a host produce no charge row (money conservation caveat)', () => {
    const r = computeFinalizeCharges({
      goingPlayers: ['A'],
      guests: [{ name: 'Orphan', brought_by: null }],
      hoursMap: {},
      totalCost: 88, // hours still count the guest: 2+2 = 4h
    });
    expect(r.guestCharges).toHaveLength(0);
    // Documents existing behavior: the orphan guest's share is NOT collected.
    expect(r.playerCharges[0].amount).toBe(44);
  });

  it('conserves money: charges sum to totalCost within rounding tolerance', () => {
    const r = computeFinalizeCharges({
      goingPlayers: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      guests: [{ name: 'G1', brought_by: 'B' }, { name: 'G2', brought_by: 'B' }],
      hoursMap: { A: 1, C: 1 },
      totalCost: 154,
    });
    const sum =
      r.playerCharges.reduce((s, c) => s + c.amount, 0) +
      r.guestCharges.reduce((s, c) => s + c.amount, 0);
    // 3-decimal rounding per row: total drift bounded by rows × 0.0005
    expect(Math.abs(sum - 154)).toBeLessThan(0.01);
  });

  it('zero total hours yields zero rate and zero charges', () => {
    const r = computeFinalizeCharges({
      goingPlayers: ['A'],
      guests: [],
      hoursMap: { A: 0 },
      totalCost: 100,
    });
    expect(r.ratePerHour).toBe(0);
    expect(r.playerCharges[0].amount).toBe(0);
  });
});

describe('computeAdjustedCharges', () => {
  it('folds guest hours into the host and rounds to 2 decimals', () => {
    const r = computeAdjustedCharges({
      players: ['A', 'B'],
      guests: [{ name: 'G1', brought_by: 'A' }],
      playerHours: { G1: 1 }, // guest played only 1h this time
      sessionHours: 2,
      totalCost: 110, // A:2 + B:2 + G1:1 = 5h → $22/h
    })!;
    const byName = Object.fromEntries(r.playerCharges.map(c => [c.name, c.amount]));
    expect(byName.A).toBe(66); // own 44 + guest 22, single row
    expect(byName.B).toBe(44);
  });

  it('defaults absent names to sessionHours, not a flat 2', () => {
    const r = computeAdjustedCharges({
      players: ['A', 'B'],
      guests: [],
      playerHours: {},
      sessionHours: 1,
      totalCost: 44,
    })!;
    expect(r.totalPlayerHours).toBe(2); // 1h each
    r.playerCharges.forEach(c => expect(c.amount).toBe(22));
  });

  it('returns null when total hours is 0 (caller aborts with a toast)', () => {
    const r = computeAdjustedCharges({
      players: ['A'],
      guests: [],
      playerHours: { A: 0 },
      sessionHours: 2,
      totalCost: 100,
    });
    expect(r).toBeNull();
  });

  it('conserves money within 2-decimal rounding', () => {
    const r = computeAdjustedCharges({
      players: ['A', 'B', 'C'],
      guests: [{ name: 'G1', brought_by: 'C' }],
      playerHours: { A: 1.5 },
      sessionHours: 2,
      totalCost: 100,
    })!;
    const sum = r.playerCharges.reduce((s, c) => s + c.amount, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.02);
  });
});

describe('rounding helpers', () => {
  it('round3 / round2 behave as the ledger expects', () => {
    expect(round3(33.33333)).toBe(33.333);
    expect(round2(21.005)).toBe(21.01);
    expect(round3(0.1 + 0.2)).toBe(0.3); // float artifact squashed
  });
});
