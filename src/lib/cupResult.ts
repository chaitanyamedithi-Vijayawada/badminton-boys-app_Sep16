// Turn a Cup tournament's teams + matches into the Winners-board entry:
// champions, runners-up and the final score. Pure logic, no Supabase.
import {
  groupStandings, resolveBracket, podium, simulateTestScores,
  type Group, type GTeam, type GMatch, type GStanding, type KoLabel, type KoResult, type TestFill, type Rng,
} from './groupsKnockout';
import { computeStandings } from './tournament';

export interface CupTournament {
  name: string;
  format: string;
  third_place: boolean;
  semi_best_of?: number | null;
  final_best_of?: number | null;
  third_best_of?: number | null;
}
export interface CupTeam { id: string; name: string; seed: number | null; group_name?: string | null }
export interface CupMatch {
  id: string; round: number; court: number;
  team_a: string | null; team_b: string | null;
  score_a: number | null; score_b: number | null;
  stage: string; group_name?: string | null; label?: string | null;
  games?: [number, number][] | null;
}

export interface CupResult {
  champions: string[];   // player names
  runnersUp: string[];
  finalScore: string | null; // e.g. "21–18, 19–21, 21–15", winner's points first
}

/** "Subash + Bharath" → ["Subash", "Bharath"]. Also splits on &, /, "and". */
export function playersOf(teamName: string): string[] {
  return teamName.split(/\s*(?:\+|&|\/|,|\band\b)\s*/i).map(s => s.trim()).filter(Boolean);
}

function fmtGames(games: [number, number][], winnerIsA: boolean): string {
  return games.map(([a, b]) => (winnerIsA ? `${a}–${b}` : `${b}–${a}`)).join(', ');
}

/** Champions and runners-up, or null while the tournament has no winner yet. */
export function cupResult(t: CupTournament, teams: CupTeam[], matches: CupMatch[]): CupResult | null {
  const nameOf = new Map(teams.map(x => [x.id, x.name]));
  const build = (win: string, lose: string | null, score: string | null): CupResult => ({
    champions: playersOf(nameOf.get(win) ?? ''),
    runnersUp: lose ? playersOf(nameOf.get(lose) ?? '') : [],
    finalScore: score || null,
  });

  if (t.format === 'groups_knockout') {
    const gTeams: GTeam[] = teams
      .filter(x => x.group_name === 'A' || x.group_name === 'B')
      .map(x => ({ id: x.id, name: x.name, group: x.group_name as Group, seed: x.seed ?? 0 }));
    const standings = {} as Record<Group, GStanding[]>;
    const complete = {} as Record<Group, boolean>;
    for (const g of ['A', 'B'] as Group[]) {
      const ms = matches.filter(m => m.stage === 'group' && m.group_name === g);
      const gm: GMatch[] = ms.map(m => ({ teamA: m.team_a ?? '', teamB: m.team_b ?? '', scoreA: m.score_a, scoreB: m.score_b }));
      standings[g] = groupStandings(gTeams.filter(x => x.group === g), gm);
      complete[g] = ms.length > 0 && ms.every(m => m.score_a != null && m.score_b != null);
    }
    const results: Partial<Record<KoLabel, KoResult>> = {};
    matches.forEach(m => {
      if (m.label && m.games?.length) results[m.label as KoLabel] = { games: m.games, teamA: m.team_a, teamB: m.team_b };
    });
    const bracket = resolveBracket(standings, complete, results, {
      semi: t.semi_best_of ?? 1, final: t.final_best_of ?? 3, third: t.third_best_of ?? 1,
    }, t.third_place);
    const top = podium(bracket);
    if (!top.first) return null;
    const final = bracket.find(k => k.label === 'FINAL');
    return build(top.first, top.second, final ? fmtGames(final.games, final.winner === final.teamA) : null);
  }

  // Round-robin with a final: the final decides it.
  const final = matches.find(m => m.stage === 'final');
  if (final) {
    if (final.score_a == null || final.score_b == null || final.score_a === final.score_b || !final.team_a || !final.team_b) return null;
    const aWon = final.score_a > final.score_b;
    return build(aWon ? final.team_a : final.team_b, aWon ? final.team_b : final.team_a,
      fmtGames([[final.score_a, final.score_b]], aWon));
  }

  // Plain round robin: top of the table once every match is played.
  const group = matches.filter(m => m.stage === 'group');
  if (!group.length || group.some(m => m.score_a == null || m.score_b == null)) return null;
  const table = computeStandings(
    teams.map(x => ({ id: x.id, name: x.name })),
    group.map(m => ({ round: m.round, court: m.court, teamA: m.team_a ?? '', teamB: m.team_b ?? '' })),
    group.map(m => ({ round: m.round, court: m.court, scoreA: m.score_a, scoreB: m.score_b })),
  );
  if (!table[0]) return null;
  return build(table[0].teamId, table[1]?.teamId ?? null, null);
}

/** Apply a test fill to matches in memory (nothing is saved). */
export function applyTestFill(matches: CupMatch[], fill: TestFill): CupMatch[] {
  const group = new Map(fill.group.map(g => [g.id, g]));
  const ko = new Map(fill.knockout.map(k => [k.label, k]));
  return matches.map(m => {
    const g = group.get(m.id);
    if (g) return { ...m, score_a: g.scoreA, score_b: g.scoreB };
    const k = m.label ? ko.get(m.label as KoLabel) : undefined;
    if (k) return { ...m, team_a: k.teamA, team_b: k.teamB, games: k.games };
    return m;
  });
}

/**
 * For a "test" Winners entry: the real result if the tournament is finished,
 * otherwise a simulated one from random scores (groups + knockout only).
 * Nothing is written to the tournament.
 */
export function cupResultOrSimulated(
  t: CupTournament, teams: CupTeam[], matches: CupMatch[], rng: Rng = Math.random,
): { result: CupResult | null; simulated: boolean } {
  const real = cupResult(t, teams, matches);
  if (real || t.format !== 'groups_knockout') return { result: real, simulated: false };
  const gTeams: GTeam[] = teams
    .filter(x => x.group_name === 'A' || x.group_name === 'B')
    .map(x => ({ id: x.id, name: x.name, group: x.group_name as Group, seed: x.seed ?? 0 }));
  const existing: Partial<Record<KoLabel, KoResult>> = {};
  matches.forEach(m => {
    if (m.label && m.games?.length) existing[m.label as KoLabel] = { games: m.games, teamA: m.team_a, teamB: m.team_b };
  });
  const fill = simulateTestScores(
    gTeams,
    matches.filter(m => m.stage === 'group').map(m => ({
      id: m.id, group: m.group_name as Group, teamA: m.team_a ?? '', teamB: m.team_b ?? '', scoreA: m.score_a, scoreB: m.score_b,
    })),
    existing,
    { semi: t.semi_best_of ?? 1, final: t.final_best_of ?? 3, third: t.third_best_of ?? 1 },
    t.third_place,
    rng,
  );
  return { result: cupResult(t, teams, applyTestFill(matches, fill)), simulated: true };
}
