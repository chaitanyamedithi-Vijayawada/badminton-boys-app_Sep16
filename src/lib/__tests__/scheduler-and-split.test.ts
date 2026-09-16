import { describe, it, expect } from 'vitest';
import {
  parseCourtSplit,
  courtSplitCourtHours,
  courtSplitMaxCourts,
  courtSplitTotalHours,
} from '../constants';
import {
  generateNextRound,
  updateTrackingFromRound,
  rebuildTrackingFromRounds,
} from '../matchScheduler';
import type { MatchRound } from '../../types';

describe('court split parsing', () => {
  it('parses a valid split setting', () => {
    const raw = JSON.stringify({ enabled: true, segments: [{ courts: 3, hours: 1 }, { courts: 4, hours: 1 }] });
    const s = parseCourtSplit(raw)!;
    expect(s.enabled).toBe(true);
    expect(courtSplitCourtHours(s)).toBe(7);
    expect(courtSplitMaxCourts(s)).toBe(4);
    expect(courtSplitTotalHours(s)).toBe(2);
  });

  it('drops zero/negative/garbage segments', () => {
    const raw = JSON.stringify({ enabled: true, segments: [{ courts: 0, hours: 1 }, { courts: 'x', hours: 2 }, { courts: 2, hours: 1 }] });
    const s = parseCourtSplit(raw)!;
    expect(s.segments).toEqual([{ courts: 2, hours: 1 }]);
  });

  it('returns null for malformed JSON, null, and missing segments', () => {
    expect(parseCourtSplit('not json')).toBeNull();
    expect(parseCourtSplit(null)).toBeNull();
    expect(parseCourtSplit(undefined)).toBeNull();
    expect(parseCourtSplit(JSON.stringify({ enabled: true }))).toBeNull();
  });

  it('disabled split contributes zero court-hours', () => {
    const s = parseCourtSplit(JSON.stringify({ enabled: false, segments: [{ courts: 3, hours: 1 }] }))!;
    expect(courtSplitCourtHours(s)).toBe(0);
  });
});

// ── Scheduler fairness ────────────────────────────────────────────────────────
// Free Mix (rounds 1–5) uses equalPlay: sit-outs rotate purely by games
// played, ignoring skill/guest status. The invariant the club cares about:
// after N rounds the games-played spread across all players stays at the
// mathematical minimum (≤ 1 whenever total court slots don't divide evenly).

function simulateRounds(
  players: string[],
  courts: number[],
  numRounds: number,
  skillMap: Record<string, string> = {},
  guests: string[] = [],
) {
  const rounds: MatchRound[] = [];
  let gamesPlayed: Record<string, number> = {};
  let restCount: Record<string, number> = {};
  let partnerHistory: Record<string, number> = {};
  let opponentHistory: Record<string, number> = {};

  for (let i = 0; i < numRounds; i++) {
    const round = generateNextRound(
      players, courts, rounds,
      partnerHistory, opponentHistory, restCount, gamesPlayed,
      skillMap, guests,
    );
    rounds.push(round);
    ({ gamesPlayed, restCount, partnerHistory, opponentHistory } =
      updateTrackingFromRound(round, gamesPlayed, restCount, partnerHistory, opponentHistory));
  }
  return { rounds, gamesPlayed, restCount };
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);

describe('match scheduler — structural invariants', () => {
  it('every round: 4 players per court, nobody duplicated, everyone accounted for', () => {
    const players = names(10);
    const { rounds } = simulateRounds(players, [1, 2], 5);
    for (const round of rounds) {
      const seen = new Set<string>();
      for (const a of round.assignments) {
        expect(a.team1).toHaveLength(2);
        expect(a.team2).toHaveLength(2);
        for (const p of [...a.team1, ...a.team2]) {
          expect(seen.has(p)).toBe(false);
          seen.add(p);
        }
      }
      for (const p of round.resting) {
        expect(seen.has(p)).toBe(false);
        seen.add(p);
      }
      expect(seen.size).toBe(players.length);
      expect(round.resting).toHaveLength(players.length - 8); // 10 − capacity 8
    }
  });

  it('fewer than 4 players yields an empty round with everyone resting', () => {
    const round = generateNextRound(['A', 'B', 'C'], [1], [], {}, {}, {}, {});
    expect(round.assignments).toHaveLength(0);
    expect(round.resting).toEqual(['A', 'B', 'C']);
  });
});

describe('match scheduler — Free Mix equalPlay fairness', () => {
  it('10 players / 2 courts / 5 rounds: games-played spread ≤ 1', () => {
    const players = names(10);
    const skillMap: Record<string, string> = { P1: 'E', P2: 'E', P3: 'B', P4: 'B' };
    const { gamesPlayed } = simulateRounds(players, [1, 2], 5, skillMap);
    const counts = players.map(p => gamesPlayed[p] || 0);
    // 5 rounds × 8 slots = 40 games over 10 players = exactly 4 each,
    // so the spread must be the mathematical minimum.
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(40);
  });

  it('guests get equal play during Free Mix (not benched preferentially)', () => {
    const players = [...names(9), 'Guest1'];
    const { gamesPlayed } = simulateRounds(players, [1, 2], 5, {}, ['Guest1']);
    const counts = players.map(p => gamesPlayed[p] || 0);
    const spread = Math.max(...counts) - Math.min(...counts);
    expect(spread).toBeLessThanOrEqual(1);
    // The guest specifically is within 1 game of everyone else
    const guestGames = gamesPlayed['Guest1'] || 0;
    expect(Math.max(...counts) - guestGames).toBeLessThanOrEqual(1);
  });

  it('13 players / 3 courts / 5 rounds (uneven): spread stays ≤ 1', () => {
    const players = names(13);
    const { gamesPlayed } = simulateRounds(players, [1, 2, 3], 5);
    const counts = players.map(p => gamesPlayed[p] || 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});

describe('match scheduler — skill phase (rounds 6+)', () => {
  it('experts never pair with beginners once the skill phase starts', () => {
    const players = names(12);
    const skillMap: Record<string, string> = {
      P1: 'E', P2: 'E', P3: 'E', P4: 'E',
      P5: 'I', P6: 'I', P7: 'I', P8: 'I',
      P9: 'B', P10: 'B', P11: 'B', P12: 'B',
    };
    const { rounds } = simulateRounds(players, [1, 2, 3], 8, skillMap);
    const skillRounds = rounds.slice(5); // rounds 6–8
    for (const round of skillRounds) {
      for (const a of round.assignments) {
        for (const team of [a.team1, a.team2]) {
          const tiers = team.map(p => skillMap[p]);
          const hasE = tiers.includes('E');
          const hasB = tiers.includes('B');
          expect(hasE && hasB).toBe(false);
        }
      }
    }
  });
});

describe('rebuildTrackingFromRounds', () => {
  it('rebuilding from history matches incrementally-tracked state', () => {
    const players = names(10);
    const { rounds, gamesPlayed, restCount } = simulateRounds(players, [1, 2], 4);
    const rebuilt = rebuildTrackingFromRounds(rounds, players);
    expect(rebuilt.gamesPlayed).toEqual(expect.objectContaining(gamesPlayed));
    for (const p of players) {
      expect(rebuilt.restCount[p] || 0).toBe(restCount[p] || 0);
    }
  });
});
