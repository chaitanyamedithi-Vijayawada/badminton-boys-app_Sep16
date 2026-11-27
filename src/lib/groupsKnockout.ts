// ── Groups + knockout tournament engine ──────────────────────────────────────
// Pure logic for the "2 groups of 6 → quarterfinals → semis → final" format
// (12 teams, 5 courts). No React or Supabase, so it is unit-tested directly.
//
// Group stage: round robin inside each group, one game to 21, no deuce.
// Knockout: BWF rally scoring (21, win by 2, cap 30). Quarterfinals are one
// game; semifinals, final and 3rd place can each be one game or best of 3.

export type Group = 'A' | 'B';

export interface GroupFixture {
  group: Group;
  round: number;   // 1..6
  court: number;   // 1..5
  a: number;       // seed within the group, 1..6
  b: number;
}

// The fixed schedule from the club's printed tracker (12 teams, 6 rounds,
// 5 courts). Odd rounds: A on courts 1–3, B on 4–5. Even rounds: A on 1–2,
// B on 3–5. Every pair in a group meets exactly once.
export const GROUP_SCHEDULE_2x6: GroupFixture[] = [
  // Group A
  { group: 'A', round: 1, court: 1, a: 1, b: 6 },
  { group: 'A', round: 1, court: 2, a: 2, b: 5 },
  { group: 'A', round: 1, court: 3, a: 3, b: 4 },
  { group: 'A', round: 2, court: 1, a: 1, b: 3 },
  { group: 'A', round: 2, court: 2, a: 4, b: 2 },
  { group: 'A', round: 3, court: 1, a: 1, b: 5 },
  { group: 'A', round: 3, court: 2, a: 6, b: 4 },
  { group: 'A', round: 3, court: 3, a: 2, b: 3 },
  { group: 'A', round: 4, court: 1, a: 5, b: 6 },
  { group: 'A', round: 4, court: 2, a: 1, b: 2 },
  { group: 'A', round: 5, court: 1, a: 1, b: 4 },
  { group: 'A', round: 5, court: 2, a: 5, b: 3 },
  { group: 'A', round: 5, court: 3, a: 6, b: 2 },
  { group: 'A', round: 6, court: 1, a: 3, b: 6 },
  { group: 'A', round: 6, court: 2, a: 4, b: 5 },
  // Group B
  { group: 'B', round: 1, court: 4, a: 1, b: 3 },
  { group: 'B', round: 1, court: 5, a: 4, b: 2 },
  { group: 'B', round: 2, court: 3, a: 1, b: 6 },
  { group: 'B', round: 2, court: 4, a: 2, b: 5 },
  { group: 'B', round: 2, court: 5, a: 3, b: 4 },
  { group: 'B', round: 3, court: 4, a: 5, b: 6 },
  { group: 'B', round: 3, court: 5, a: 1, b: 2 },
  { group: 'B', round: 4, court: 3, a: 1, b: 5 },
  { group: 'B', round: 4, court: 4, a: 6, b: 4 },
  { group: 'B', round: 4, court: 5, a: 2, b: 3 },
  { group: 'B', round: 5, court: 4, a: 3, b: 6 },
  { group: 'B', round: 5, court: 5, a: 4, b: 5 },
  { group: 'B', round: 6, court: 3, a: 1, b: 4 },
  { group: 'B', round: 6, court: 4, a: 5, b: 3 },
  { group: 'B', round: 6, court: 5, a: 6, b: 2 },
];

export const TEAMS_PER_GROUP = 6;
export const COURTS = 5;
export const QUALIFIERS_PER_GROUP = 4;

// ── Knockout layout ───────────────────────────────────────────────────────────

export type KoLabel = 'QF1' | 'QF2' | 'QF3' | 'QF4' | 'SF1' | 'SF2' | 'FINAL' | 'THIRD';
export type KoStage = 'quarterfinal' | 'semifinal' | 'final' | 'third_place';

export interface KoSlotDef {
  label: KoLabel;
  stage: KoStage;
  round: number;
  court: number;
  // Where each side comes from: a group seed (e.g. A1) or a previous match.
  a: { seed: [Group, number] } | { winnerOf: KoLabel } | { loserOf: KoLabel };
  b: { seed: [Group, number] } | { winnerOf: KoLabel } | { loserOf: KoLabel };
}

export const KNOCKOUT_LAYOUT: KoSlotDef[] = [
  { label: 'QF1', stage: 'quarterfinal', round: 7, court: 1, a: { seed: ['A', 1] }, b: { seed: ['B', 3] } },
  { label: 'QF2', stage: 'quarterfinal', round: 7, court: 2, a: { seed: ['B', 1] }, b: { seed: ['A', 3] } },
  { label: 'QF3', stage: 'quarterfinal', round: 7, court: 3, a: { seed: ['A', 2] }, b: { seed: ['B', 4] } },
  { label: 'QF4', stage: 'quarterfinal', round: 7, court: 4, a: { seed: ['B', 2] }, b: { seed: ['A', 4] } },
  { label: 'SF1', stage: 'semifinal', round: 8, court: 1, a: { winnerOf: 'QF1' }, b: { winnerOf: 'QF3' } },
  { label: 'SF2', stage: 'semifinal', round: 8, court: 2, a: { winnerOf: 'QF2' }, b: { winnerOf: 'QF4' } },
  { label: 'FINAL', stage: 'final', round: 9, court: 1, a: { winnerOf: 'SF1' }, b: { winnerOf: 'SF2' } },
  { label: 'THIRD', stage: 'third_place', round: 9, court: 2, a: { loserOf: 'SF1' }, b: { loserOf: 'SF2' } },
];

export function koTitle(label: KoLabel): string {
  if (label === 'FINAL') return 'Final';
  if (label === 'THIRD') return '3rd Place';
  return label.startsWith('QF') ? `Quarterfinal ${label.slice(2)}` : `Semifinal ${label.slice(2)}`;
}

export function sourceText(src: KoSlotDef['a']): string {
  if ('seed' in src) return `#${src.seed[1]} Group ${src.seed[0]}`;
  if ('winnerOf' in src) return `Winner ${src.winnerOf}`;
  return `Loser ${src.loserOf}`;
}

// ── Score rules ───────────────────────────────────────────────────────────────

/** Group game: first to 21, no deuce → exactly one side has 21, the other 0–20. */
export function groupScoreProblem(a: number, b: number): string | null {
  if (![a, b].every(n => Number.isInteger(n) && n >= 0)) return 'Scores must be whole numbers';
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi !== 21 || lo > 20) return 'Group games are to 21 with no deuce (e.g. 21–18)';
  return null;
}

/** Knockout game: BWF rally scoring — 21 win by 2, cap 30. */
export function knockoutGameProblem(a: number, b: number): string | null {
  if (![a, b].every(n => Number.isInteger(n) && n >= 0)) return 'Scores must be whole numbers';
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi === 21 && lo <= 19) return null;
  if (hi >= 22 && hi <= 29 && lo === hi - 2) return null;
  if (hi === 30 && (lo === 28 || lo === 29)) return null;
  return 'Knockout games: 21 win by 2, capped at 30 (e.g. 21–19, 23–21, 30–29)';
}

export type Game = [number, number];

export interface SeriesResult {
  winsA: number;
  winsB: number;
  winner: 'A' | 'B' | null; // null until someone has won enough games
}

/** Who won a one-game or best-of-N match, from the game scores. */
export function seriesResult(games: Game[], bestOf: number): SeriesResult {
  const need = Math.floor(bestOf / 2) + 1;
  let winsA = 0, winsB = 0;
  for (const [a, b] of games) {
    if (a > b) winsA++; else if (b > a) winsB++;
  }
  const winner = winsA >= need ? 'A' : winsB >= need ? 'B' : null;
  return { winsA, winsB, winner };
}

/** Problems with a set of knockout game scores for a best-of-N match. */
export function seriesProblem(games: Game[], bestOf: number): string | null {
  if (games.length === 0) return 'Enter at least one game';
  for (const [a, b] of games) {
    const p = knockoutGameProblem(a, b);
    if (p) return p;
  }
  const need = Math.floor(bestOf / 2) + 1;
  let wa = 0, wb = 0;
  for (let i = 0; i < games.length; i++) {
    if (wa >= need || wb >= need) return 'Too many games: the match was already decided';
    const [a, b] = games[i];
    if (a > b) wa++; else wb++;
  }
  if (wa < need && wb < need) return `Best of ${bestOf}: someone needs ${need} game wins`;
  return null;
}

// ── Group standings ───────────────────────────────────────────────────────────

export interface GTeam { id: string; name: string; group: Group; seed: number }
export interface GMatch { teamA: string; teamB: string; scoreA: number | null; scoreB: number | null }

export interface GStanding {
  teamId: string;
  name: string;
  seed: number;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  rank: number;
}

/**
 * Rank a group: (1) match wins; (2) head-to-head when exactly two teams are
 * tied on wins; (3) point difference; then points scored; then seed.
 */
export function groupStandings(teams: GTeam[], matches: GMatch[]): GStanding[] {
  const table = new Map<string, GStanding>();
  for (const t of teams) {
    table.set(t.id, {
      teamId: t.id, name: t.name, seed: t.seed, played: 0, wins: 0, losses: 0,
      pointsFor: 0, pointsAgainst: 0, diff: 0, rank: 0,
    });
  }
  const h2h = new Map<string, string>(); // "x|y" → winner id
  for (const m of matches) {
    if (m.scoreA == null || m.scoreB == null) continue;
    const a = table.get(m.teamA), b = table.get(m.teamB);
    if (!a || !b) continue;
    a.played++; b.played++;
    a.pointsFor += m.scoreA; a.pointsAgainst += m.scoreB;
    b.pointsFor += m.scoreB; b.pointsAgainst += m.scoreA;
    if (m.scoreA > m.scoreB) { a.wins++; b.losses++; h2h.set(`${a.teamId}|${b.teamId}`, a.teamId); h2h.set(`${b.teamId}|${a.teamId}`, a.teamId); }
    else if (m.scoreB > m.scoreA) { b.wins++; a.losses++; h2h.set(`${a.teamId}|${b.teamId}`, b.teamId); h2h.set(`${b.teamId}|${a.teamId}`, b.teamId); }
  }
  const rows = [...table.values()];
  rows.forEach(r => { r.diff = r.pointsFor - r.pointsAgainst; });

  const winsCount = new Map<number, number>();
  rows.forEach(r => winsCount.set(r.wins, (winsCount.get(r.wins) ?? 0) + 1));

  rows.sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (winsCount.get(x.wins) === 2) {
      const w = h2h.get(`${x.teamId}|${y.teamId}`);
      if (w === x.teamId) return -1;
      if (w === y.teamId) return 1;
    }
    return y.diff - x.diff || y.pointsFor - x.pointsFor || x.seed - y.seed;
  });
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// ── Bracket ───────────────────────────────────────────────────────────────────

// games: empty = not played. teamA/teamB: who the result was recorded for; if
// an earlier score changes and different teams now meet, the old result is
// ignored (marked stale) instead of being credited to the wrong teams.
export interface KoResult { games: Game[]; teamA?: string | null; teamB?: string | null }

export interface KoResolved {
  label: KoLabel;
  stage: KoStage;
  round: number;
  court: number;
  bestOf: number;
  sourceA: string;
  sourceB: string;
  teamA: string | null; // null = not decided yet (TBD)
  teamB: string | null;
  games: Game[];
  winsA: number;
  winsB: number;
  winner: string | null;
  loser: string | null;
  stale: boolean; // a result exists but was recorded for different teams
}

export interface BestOfConfig { semi: number; final: number; third: number }

export function bestOfFor(stage: KoStage, cfg: BestOfConfig): number {
  if (stage === 'semifinal') return cfg.semi;
  if (stage === 'final') return cfg.final;
  if (stage === 'third_place') return cfg.third;
  return 1;
}

/**
 * Work out every knockout match's teams and result. Quarterfinal teams come
 * from the group standings once that group is complete; later rounds from the
 * winners/losers of earlier matches.
 */
export function resolveBracket(
  standings: Record<Group, GStanding[]>,
  groupComplete: Record<Group, boolean>,
  results: Partial<Record<KoLabel, KoResult>>,
  cfg: BestOfConfig,
  includeThird = true,
): KoResolved[] {
  const out = new Map<KoLabel, KoResolved>();
  const pick = (src: KoSlotDef['a']): string | null => {
    if ('seed' in src) {
      const [g, rank] = src.seed;
      if (!groupComplete[g]) return null;
      return standings[g][rank - 1]?.teamId ?? null;
    }
    const prev = out.get('winnerOf' in src ? src.winnerOf : src.loserOf);
    if (!prev) return null;
    return 'winnerOf' in src ? prev.winner : prev.loser;
  };

  for (const def of KNOCKOUT_LAYOUT) {
    if (def.label === 'THIRD' && !includeThird) continue;
    const bestOf = bestOfFor(def.stage, cfg);
    const teamA = pick(def.a);
    const teamB = pick(def.b);
    const r = results[def.label];
    const recordedFor = r && r.teamA !== undefined && r.teamB !== undefined;
    const matches = !recordedFor || (r!.teamA === teamA && r!.teamB === teamB);
    const stale = !!r?.games.length && (!teamA || !teamB || !matches);
    const games = teamA && teamB && r && matches ? r.games : [];
    const s = seriesResult(games, bestOf);
    const winner = s.winner === 'A' ? teamA : s.winner === 'B' ? teamB : null;
    const loser = s.winner === 'A' ? teamB : s.winner === 'B' ? teamA : null;
    out.set(def.label, {
      label: def.label, stage: def.stage, round: def.round, court: def.court, bestOf,
      sourceA: sourceText(def.a), sourceB: sourceText(def.b),
      teamA, teamB, games, winsA: s.winsA, winsB: s.winsB, winner, loser, stale,
    });
  }
  return [...out.values()];
}

/** Final placings once decided: champion, runner-up, third. */
export function podium(bracket: KoResolved[]): { first: string | null; second: string | null; third: string | null } {
  const final = bracket.find(m => m.label === 'FINAL');
  const third = bracket.find(m => m.label === 'THIRD');
  return { first: final?.winner ?? null, second: final?.loser ?? null, third: third?.winner ?? null };
}

/** Teams from this Saturday's printed tracker, to prefill the setup screen. */
export const SAMPLE_TEAMS: Record<Group, string[]> = {
  A: ['Subash + Bharath', 'Avi + Chaitu', 'Navan + Vikash', 'Sai + Nag', 'Veera + Jitin', 'Arun + Rakesh'],
  B: ['Gopi + Ganesh', 'Surya + Abhi', 'Shailesh + Arima', 'Jatinder + Ashok', 'Siva + Ravi', 'Kanna + Malli'],
};

// ── Test fill ─────────────────────────────────────────────────────────────────
// Random but valid scores so admins can try the whole format end to end before
// the real event (then use Reset). Existing scores are kept; only gaps are filled.

export type Rng = () => number;
const randInt = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

export function randomGroupScore(rng: Rng): Game {
  const lo = randInt(rng, 8, 20);
  return rng() < 0.5 ? [21, lo] : [lo, 21];
}

export function randomKnockoutGame(rng: Rng): Game {
  let hi: number, lo: number;
  if (rng() < 0.8) { hi = 21; lo = randInt(rng, 8, 19); }
  else { hi = randInt(rng, 22, 30); lo = hi === 30 ? randInt(rng, 28, 29) : hi - 2; }
  return rng() < 0.5 ? [hi, lo] : [lo, hi];
}

export function randomSeries(bestOf: number, rng: Rng): Game[] {
  const need = Math.floor(bestOf / 2) + 1;
  const games: Game[] = [];
  let wa = 0, wb = 0;
  while (wa < need && wb < need) {
    const g = randomKnockoutGame(rng);
    games.push(g);
    if (g[0] > g[1]) wa++; else wb++;
  }
  return games;
}

export interface FillGroupMatch extends GMatch { id: string; group: Group }
export interface TestFill {
  group: { id: string; scoreA: number; scoreB: number }[];
  knockout: { label: KoLabel; teamA: string; teamB: string; games: Game[] }[];
}

export function simulateTestScores(
  teams: GTeam[],
  groupMatches: FillGroupMatch[],
  existingKo: Partial<Record<KoLabel, KoResult>>,
  cfg: BestOfConfig,
  includeThird: boolean,
  rng: Rng = Math.random,
): TestFill {
  const fill: TestFill = { group: [], knockout: [] };
  const played = groupMatches.map(m => {
    if (m.scoreA != null && m.scoreB != null) return m;
    const [a, b] = randomGroupScore(rng);
    fill.group.push({ id: m.id, scoreA: a, scoreB: b });
    return { ...m, scoreA: a, scoreB: b };
  });
  const standings = {} as Record<Group, GStanding[]>;
  for (const g of ['A', 'B'] as Group[]) {
    standings[g] = groupStandings(teams.filter(t => t.group === g), played.filter(m => m.group === g));
  }
  const complete: Record<Group, boolean> = { A: true, B: true };
  const results: Partial<Record<KoLabel, KoResult>> = { ...existingKo };
  // Walk the bracket in order; each pass can decide the next match's teams.
  for (const def of KNOCKOUT_LAYOUT) {
    if (def.label === 'THIRD' && !includeThird) continue;
    const slot = resolveBracket(standings, complete, results, cfg, includeThird).find(k => k.label === def.label);
    if (!slot?.teamA || !slot.teamB || slot.winner) continue;
    const games = randomSeries(slot.bestOf, rng);
    results[def.label] = { games, teamA: slot.teamA, teamB: slot.teamB };
    fill.knockout.push({ label: def.label, teamA: slot.teamA, teamB: slot.teamB, games });
  }
  return fill;
}
