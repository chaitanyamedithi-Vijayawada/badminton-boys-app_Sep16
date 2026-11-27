import { describe, it, expect } from 'vitest';
import {
  GROUP_SCHEDULE_2x6, groupScoreProblem, knockoutGameProblem, seriesResult, seriesProblem,
  groupStandings, resolveBracket, podium, simulateTestScores, type GTeam, type GMatch, type Group, type GStanding,
} from '../groupsKnockout';

describe('fixed 12-team schedule', () => {
  for (const g of ['A', 'B'] as Group[]) {
    it(`group ${g}: every pair plays exactly once (15 matches)`, () => {
      const fx = GROUP_SCHEDULE_2x6.filter(f => f.group === g);
      expect(fx).toHaveLength(15);
      const pairs = new Set(fx.map(f => [f.a, f.b].sort().join('-')));
      expect(pairs.size).toBe(15);
    });
    it(`group ${g}: each team plays 5 matches, never twice in a round`, () => {
      const fx = GROUP_SCHEDULE_2x6.filter(f => f.group === g);
      for (let s = 1; s <= 6; s++) expect(fx.filter(f => f.a === s || f.b === s)).toHaveLength(5);
      for (let r = 1; r <= 6; r++) {
        const seen = fx.filter(f => f.round === r).flatMap(f => [f.a, f.b]);
        expect(new Set(seen).size).toBe(seen.length);
      }
    });
  }
  it('uses each of the 5 courts at most once per round', () => {
    for (let r = 1; r <= 6; r++) {
      const courts = GROUP_SCHEDULE_2x6.filter(f => f.round === r).map(f => f.court);
      expect(courts).toHaveLength(5);
      expect(new Set(courts).size).toBe(5);
    }
  });
  it('matches the printed tracker spot checks', () => {
    expect(GROUP_SCHEDULE_2x6).toContainEqual({ group: 'A', round: 1, court: 1, a: 1, b: 6 });
    expect(GROUP_SCHEDULE_2x6).toContainEqual({ group: 'B', round: 6, court: 5, a: 6, b: 2 });
  });
});

describe('score rules', () => {
  it('group games: 21 no deuce', () => {
    expect(groupScoreProblem(21, 18)).toBeNull();
    expect(groupScoreProblem(20, 21)).toBeNull();
    expect(groupScoreProblem(22, 20)).not.toBeNull();
    expect(groupScoreProblem(19, 18)).not.toBeNull();
  });
  it('knockout games: 21 win by 2, cap 30', () => {
    expect(knockoutGameProblem(21, 19)).toBeNull();
    expect(knockoutGameProblem(23, 21)).toBeNull();
    expect(knockoutGameProblem(30, 29)).toBeNull();
    expect(knockoutGameProblem(21, 20)).not.toBeNull();
    expect(knockoutGameProblem(25, 21)).not.toBeNull();
    expect(knockoutGameProblem(31, 29)).not.toBeNull();
  });
  it('best of 3 winner and validation', () => {
    expect(seriesResult([[21, 18], [19, 21], [21, 15]], 3)).toEqual({ winsA: 2, winsB: 1, winner: 'A' });
    expect(seriesResult([[21, 18]], 3).winner).toBeNull();
    expect(seriesResult([[15, 21]], 1).winner).toBe('B');
    expect(seriesProblem([[21, 18], [21, 15]], 3)).toBeNull();
    expect(seriesProblem([[21, 18]], 3)).not.toBeNull();
    expect(seriesProblem([[21, 18], [21, 15], [21, 10]], 3)).not.toBeNull();
  });
});

const teamsOf = (g: Group): GTeam[] =>
  [1, 2, 3, 4, 5, 6].map(s => ({ id: `${g}${s}`, name: `${g}${s}`, group: g, seed: s }));

describe('group standings', () => {
  it('ranks by wins, then head-to-head for a two-way tie, then point difference', () => {
    const t = teamsOf('A').slice(0, 3);
    const m: GMatch[] = [
      { teamA: 'A1', teamB: 'A2', scoreA: 21, scoreB: 5 },   // A1 big win
      { teamA: 'A2', teamB: 'A3', scoreA: 21, scoreB: 19 },
      { teamA: 'A3', teamB: 'A1', scoreA: 21, scoreB: 19 },
    ];
    // All on 1 win → three-way tie → point difference: A1 +14, A2 -14, A3 0
    expect(groupStandings(t, m).map(s => s.teamId)).toEqual(['A1', 'A3', 'A2']);

    const two: GMatch[] = [
      { teamA: 'A1', teamB: 'A2', scoreA: 19, scoreB: 21 },  // A2 beat A1
      { teamA: 'A1', teamB: 'A3', scoreA: 21, scoreB: 0 },
      { teamA: 'A2', teamB: 'A3', scoreA: 21, scoreB: 20 },
    ];
    // A2 2 wins first; A1 1 win; A3 0
    expect(groupStandings(t, two).map(s => s.teamId)).toEqual(['A2', 'A1', 'A3']);
  });
  it('uses head-to-head when exactly two teams tie on wins, even against point difference', () => {
    const t = teamsOf('A').slice(0, 4);
    const m: GMatch[] = [
      { teamA: 'A1', teamB: 'A2', scoreA: 19, scoreB: 21 }, // A2 beats A1
      { teamA: 'A1', teamB: 'A3', scoreA: 21, scoreB: 0 },
      { teamA: 'A1', teamB: 'A4', scoreA: 21, scoreB: 0 },
      { teamA: 'A2', teamB: 'A3', scoreA: 20, scoreB: 21 },
      { teamA: 'A2', teamB: 'A4', scoreA: 21, scoreB: 20 },
      { teamA: 'A3', teamB: 'A4', scoreA: 0, scoreB: 21 },
    ];
    // A1 and A2 both 2 wins; A1 has the far better difference, but A2 won head-to-head.
    const order = groupStandings(t, m).map(s => s.teamId);
    expect(order.slice(0, 2)).toEqual(['A2', 'A1']);
  });
});

describe('bracket', () => {
  const st = (g: Group): GStanding[] => teamsOf(g).map((t, i) => ({
    teamId: t.id, name: t.name, seed: t.seed, played: 5, wins: 5 - i, losses: i,
    pointsFor: 0, pointsAgainst: 0, diff: 0, rank: i + 1,
  }));
  const standings = { A: st('A'), B: st('B') };
  const cfg = { semi: 1, final: 3, third: 1 };

  it('keeps quarterfinals TBD until the group is complete', () => {
    const b = resolveBracket(standings, { A: false, B: true }, {}, cfg);
    const qf1 = b.find(m => m.label === 'QF1')!;
    expect(qf1.teamA).toBeNull();      // #1 A not known yet
    expect(qf1.teamB).toBe('B3');
  });
  it('seeds quarterfinals across groups and advances winners', () => {
    const b = resolveBracket(standings, { A: true, B: true }, {
      QF1: { games: [[21, 10]] },  // A1 beats B3
      QF3: { games: [[15, 21]] },  // B4 beats A2
      QF2: { games: [[21, 12]] },  // B1 beats A3
      QF4: { games: [[21, 19]] },  // B2 beats A4
      SF1: { games: [[21, 17]] },  // A1 beats B4
      SF2: { games: [[18, 21]] },  // B2 beats B1
      FINAL: { games: [[21, 15], [17, 21], [21, 19]] }, // A1 wins 2–1
      THIRD: { games: [[21, 11]] }, // B4 beats B1
    }, cfg);
    const get = (l: string) => b.find(m => m.label === l)!;
    expect([get('QF1').teamA, get('QF1').teamB]).toEqual(['A1', 'B3']);
    expect([get('QF2').teamA, get('QF2').teamB]).toEqual(['B1', 'A3']);
    expect([get('QF3').teamA, get('QF3').teamB]).toEqual(['A2', 'B4']);
    expect([get('QF4').teamA, get('QF4').teamB]).toEqual(['B2', 'A4']);
    expect([get('SF1').teamA, get('SF1').teamB]).toEqual(['A1', 'B4']);
    expect([get('SF2').teamA, get('SF2').teamB]).toEqual(['B1', 'B2']);
    expect(get('FINAL').bestOf).toBe(3);
    expect(podium(b)).toEqual({ first: 'A1', second: 'B2', third: 'B4' });
  });
  it('a best-of-3 final with one game played is not decided', () => {
    const b = resolveBracket(standings, { A: true, B: true }, {
      QF1: { games: [[21, 10]] }, QF2: { games: [[21, 10]] }, QF3: { games: [[21, 10]] }, QF4: { games: [[21, 10]] },
      SF1: { games: [[21, 10]] }, SF2: { games: [[21, 10]] }, FINAL: { games: [[21, 10]] },
    }, cfg);
    expect(podium(b).first).toBeNull();
  });
  it('ignores a result recorded for teams that no longer meet', () => {
    const b = resolveBracket(standings, { A: true, B: true }, {
      QF1: { games: [[21, 10]], teamA: 'A1', teamB: 'B3' },
      QF2: { games: [[21, 10]], teamA: 'B9', teamB: 'A3' }, // recorded for someone else
    }, cfg);
    const qf1 = b.find(m => m.label === 'QF1')!;
    const qf2 = b.find(m => m.label === 'QF2')!;
    expect(qf1.winner).toBe('A1');
    expect(qf1.stale).toBe(false);
    expect(qf2.winner).toBeNull();
    expect(qf2.stale).toBe(true);
  });
  it('can leave out the 3rd-place match', () => {
    expect(resolveBracket(standings, { A: true, B: true }, {}, cfg, false).some(m => m.label === 'THIRD')).toBe(false);
  });
});

describe('test fill (simulateTestScores)', () => {
  // Small seeded RNG so failures are reproducible.
  const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const teams: GTeam[] = (['A', 'B'] as Group[]).flatMap(g =>
    Array.from({ length: 6 }, (_, i) => ({ id: `${g}${i + 1}`, name: `${g}${i + 1}`, group: g, seed: i + 1 })));
  const fixtures = GROUP_SCHEDULE_2x6.map((f, i) => ({
    id: `m${i}`, group: f.group, teamA: `${f.group}${f.a}`, teamB: `${f.group}${f.b}`, scoreA: null, scoreB: null,
  }));

  for (const [cfg, third] of [[{ semi: 1, final: 3, third: 1 }, false], [{ semi: 3, final: 3, third: 1 }, true]] as const) {
    it(`fills every match with valid scores and crowns a champion (semis bo${cfg.semi}, third ${third})`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const fill = simulateTestScores(teams, fixtures, {}, cfg, third, seeded(seed));
        expect(fill.group).toHaveLength(30);
        for (const g of fill.group) expect(groupScoreProblem(g.scoreA, g.scoreB)).toBeNull();
        expect(fill.knockout.map(k => k.label)).toEqual(
          third ? ['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'FINAL', 'THIRD'] : ['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'FINAL']);
        for (const k of fill.knockout) {
          const bo = k.label.startsWith('QF') ? 1 : k.label.startsWith('SF') ? cfg.semi : k.label === 'FINAL' ? cfg.final : cfg.third;
          expect(seriesProblem(k.games, bo)).toBeNull();
        }
        // Feed the fill back through the real bracket logic: it must finish.
        const played: GMatch[] = fixtures.map(m => { const g = fill.group.find(x => x.id === m.id)!; return { ...m, scoreA: g.scoreA, scoreB: g.scoreB }; });
        const st = { A: groupStandings(teams.filter(t => t.group === 'A'), played.filter((_, i) => fixtures[i].group === 'A')),
                     B: groupStandings(teams.filter(t => t.group === 'B'), played.filter((_, i) => fixtures[i].group === 'B')) } as Record<Group, GStanding[]>;
        const results = Object.fromEntries(fill.knockout.map(k => [k.label, { games: k.games, teamA: k.teamA, teamB: k.teamB }]));
        const top = podium(resolveBracket(st, { A: true, B: true }, results, cfg, third));
        expect(top.first).toBeTruthy();
        expect(!!top.third).toBe(third);
      }
    });
  }

  it('keeps scores that are already entered', () => {
    const partial = fixtures.map((m, i) => (i === 0 ? { ...m, scoreA: 21, scoreB: 5 } : m));
    const fill = simulateTestScores(teams, partial, {}, { semi: 1, final: 3, third: 1 }, false, seeded(7));
    expect(fill.group).toHaveLength(29);
    expect(fill.group.find(g => g.id === 'm0')).toBeUndefined();
  });
});
