import { describe, it, expect } from 'vitest';
import { playersOf, cupResult, cupResultOrSimulated, type CupTeam, type CupMatch, type CupTournament } from '../cupResult';
import { GROUP_SCHEDULE_2x6, KNOCKOUT_LAYOUT } from '../groupsKnockout';

const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function groupsTournament(): { t: CupTournament; teams: CupTeam[]; matches: CupMatch[] } {
  const teams: CupTeam[] = [];
  for (const g of ['A', 'B'] as const) for (let i = 1; i <= 6; i++) teams.push({ id: `${g}${i}`, name: `${g}${i}a + ${g}${i}b`, seed: i, group_name: g });
  const matches: CupMatch[] = GROUP_SCHEDULE_2x6.map((f, i) => ({
    id: `g${i}`, round: f.round, court: f.court, stage: 'group', group_name: f.group,
    team_a: `${f.group}${f.a}`, team_b: `${f.group}${f.b}`, score_a: null, score_b: null,
  }));
  KNOCKOUT_LAYOUT.forEach(k => matches.push({
    id: k.label, round: k.round, court: k.court, stage: k.stage, label: k.label,
    team_a: null, team_b: null, score_a: null, score_b: null, games: null,
  }));
  return { t: { name: 'Cup', format: 'groups_knockout', third_place: false, semi_best_of: 1, final_best_of: 3 }, teams, matches };
}

describe('playersOf', () => {
  it('splits team names into players', () => {
    expect(playersOf('Subash + Bharath')).toEqual(['Subash', 'Bharath']);
    expect(playersOf('Avi & Chaitu')).toEqual(['Avi', 'Chaitu']);
    expect(playersOf('Ravi and Nag')).toEqual(['Ravi', 'Nag']);
    expect(playersOf('Solo')).toEqual(['Solo']);
  });
});

describe('cupResult', () => {
  it('is null while a groups tournament has no champion', () => {
    const { t, teams, matches } = groupsTournament();
    expect(cupResult(t, teams, matches)).toBeNull();
  });

  it('simulated result gives two champions and two runners-up, without changing the input', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { t, teams, matches } = groupsTournament();
      const before = JSON.stringify(matches);
      const { result, simulated } = cupResultOrSimulated(t, teams, matches, lcg(seed));
      expect(simulated).toBe(true);
      expect(result?.champions).toHaveLength(2);
      expect(result?.runnersUp).toHaveLength(2);
      expect(result?.champions).not.toEqual(result?.runnersUp);
      // No 3rd-place match: both semifinal losers share bronze (4 players).
      expect(result?.third).toHaveLength(4);
      const podium = [...result!.champions, ...result!.runnersUp, ...result!.third];
      expect(new Set(podium).size).toBe(8);
      expect(result?.finalScore).toMatch(/^\d+–\d+(, \d+–\d+)*$/);
      expect(JSON.stringify(matches)).toBe(before);
    }
  });

  it('with a 3rd-place match, one team gets 3rd', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { t, teams, matches } = groupsTournament();
      const { result } = cupResultOrSimulated({ ...t, third_place: true }, teams, matches, lcg(seed));
      expect(result?.third).toHaveLength(2);
      expect(result?.third.some(p => result.champions.includes(p) || result.runnersUp.includes(p))).toBe(false);
    }
  });

  it('final score is shown from the champions\' side', () => {
    const { t, teams, matches } = groupsTournament();
    const { result } = cupResultOrSimulated(t, teams, matches, lcg(7));
    const games = result!.finalScore!.split(', ').map(g => g.split('–').map(Number));
    const won = games.filter(([a, b]) => a > b).length;
    expect(won).toBe(2);
  });

  it('round robin with a final uses the final', () => {
    const teams: CupTeam[] = [{ id: 'x', name: 'A + B', seed: 1 }, { id: 'y', name: 'C + D', seed: 2 }];
    const matches: CupMatch[] = [
      { id: '1', round: 1, court: 1, stage: 'group', team_a: 'x', team_b: 'y', score_a: 21, score_b: 10 },
      { id: '2', round: 2, court: 1, stage: 'final', team_a: 'x', team_b: 'y', score_a: 15, score_b: 21 },
    ];
    const r = cupResult({ name: 'RR', format: 'round_robin_final', third_place: false }, teams, matches);
    expect(r).toEqual({ champions: ['C', 'D'], runnersUp: ['A', 'B'], third: [], finalScore: '21–15' });
  });
});
