// ── Tournament engine ─────────────────────────────────────────────────────────
// Pure, testable logic for round-robin scheduling and live standings. No React,
// no Supabase — just the math, so it can be unit-tested in isolation. The UI and
// database layers (Stages 2 & 3) call into these.

export interface TournamentTeam {
  id: string;         // stable id (uuid or index-based)
  name: string;
}

export interface ScheduledMatch {
  round: number;      // 1-based round number
  court: number;      // 1-based court number within the round
  teamA: string;      // team id
  teamB: string;      // team id
}

export interface MatchResult {
  round: number;
  court: number;
  scoreA: number | null;
  scoreB: number | null;
}

// ── Round-robin schedule (circle method) ──────────────────────────────────────
// Generates a single round-robin: every team plays every other team exactly once.
// Uses the standard "circle" rotation. For an odd number of teams, a bye is added
// (one team rests each round). Matches within a round are then assigned to courts
// (capped by courtCount) — if a round has more matches than courts, the extras
// become additional "waves" appended as later rounds so no team is double-booked.
export function generateRoundRobin(teams: TournamentTeam[], courtCount: number): ScheduledMatch[] {
  const ids = teams.map(t => t.id);
  const hasBye = ids.length % 2 !== 0;
  const roster = hasBye ? [...ids, '__BYE__'] : [...ids];
  const n = roster.length;
  const roundsCount = n - 1;
  const half = n / 2;

  // Circle method: fix roster[0], rotate the rest each round.
  const arr = [...roster];
  const rawRounds: [string, string][][] = [];

  for (let r = 0; r < roundsCount; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== '__BYE__' && b !== '__BYE__') pairs.push([a, b]);
    }
    rawRounds.push(pairs);
    // rotate: keep arr[0], move arr[1] to the end
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop() as string);
    arr.splice(0, arr.length, fixed, ...rest);
  }

  // Assign to courts. Each conceptual round's matches all involve distinct teams,
  // so they can run in parallel — but only up to courtCount at once. Overflow
  // spills into extra waves (new round numbers) to avoid exceeding courts.
  const schedule: ScheduledMatch[] = [];
  let roundNum = 0;
  for (const pairs of rawRounds) {
    for (let i = 0; i < pairs.length; i += courtCount) {
      roundNum++;
      const wave = pairs.slice(i, i + courtCount);
      wave.forEach(([a, b], idx) => {
        schedule.push({ round: roundNum, court: idx + 1, teamA: a, teamB: b });
      });
    }
  }
  return schedule;
}

export function totalMatches(teamCount: number): number {
  return (teamCount * (teamCount - 1)) / 2;
}

// ── Standings ─────────────────────────────────────────────────────────────────
export interface TeamStanding {
  teamId: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  rank: number;
}

// Build standings from the schedule + whatever results have been entered so far.
// A match counts only when BOTH scores are present. Ranking: wins desc, then
// point differential desc, then points-for desc, then name for a stable order.
export function computeStandings(
  teams: TournamentTeam[],
  schedule: ScheduledMatch[],
  results: MatchResult[],
): TeamStanding[] {
  const byKey = new Map<string, MatchResult>();
  results.forEach(r => byKey.set(`${r.round}-${r.court}`, r));

  const table = new Map<string, TeamStanding>();
  teams.forEach(t => table.set(t.id, {
    teamId: t.id, name: t.name, played: 0, wins: 0, losses: 0,
    pointsFor: 0, pointsAgainst: 0, pointDiff: 0, rank: 0,
  }));

  for (const m of schedule) {
    const res = byKey.get(`${m.round}-${m.court}`);
    if (!res || res.scoreA == null || res.scoreB == null) continue;
    const a = table.get(m.teamA);
    const b = table.get(m.teamB);
    if (!a || !b) continue;
    a.played++; b.played++;
    a.pointsFor += res.scoreA; a.pointsAgainst += res.scoreB;
    b.pointsFor += res.scoreB; b.pointsAgainst += res.scoreA;
    if (res.scoreA > res.scoreB) { a.wins++; b.losses++; }
    else if (res.scoreB > res.scoreA) { b.wins++; a.losses++; }
    // exact ties (unusual to 21) count as played but no win/loss
  }

  const standings = [...table.values()];
  standings.forEach(s => { s.pointDiff = s.pointsFor - s.pointsAgainst; });
  standings.sort((x, y) =>
    y.wins - x.wins ||
    y.pointDiff - x.pointDiff ||
    y.pointsFor - x.pointsFor ||
    x.name.localeCompare(y.name)
  );
  standings.forEach((s, i) => { s.rank = i + 1; });
  return standings;
}

// Convenience: how many scheduled matches still need a result entered.
export function matchesRemaining(schedule: ScheduledMatch[], results: MatchResult[]): number {
  const done = new Set(
    results.filter(r => r.scoreA != null && r.scoreB != null).map(r => `${r.round}-${r.court}`)
  );
  return schedule.filter(m => !done.has(`${m.round}-${m.court}`)).length;
}

// ── Knockout stage ────────────────────────────────────────────────────────────
// After the round-robin completes, the top N teams advance to a knockout.
//   knockoutSize = 2 → a single final (#1 vs #2)
//   knockoutSize = 4 → semifinals (#1 v #4, #2 v #3), then the winners meet
// The bracket is seeded off the final round-robin standings.

export type KnockoutSize = 2 | 4;

export interface KnockoutMatch {
  stage: 'semifinal' | 'final' | 'third_place';
  slot: number;             // 1-based, for ordering/court display
  teamA: string | null;     // null until the feeding match resolves (TBD)
  teamB: string | null;
  // For semifinal slots, which standings seeds feed this match (for display).
  seedA?: number;
  seedB?: number;
}

// Build the knockout bracket skeleton from standings. For top-4, semifinal
// team slots are filled from seeds immediately; the final's teams stay null
// (TBD) until the semis are scored. For top-2, just the final, filled from
// seeds 1 and 2.
export function generateKnockout(
  standings: TeamStanding[],
  knockoutSize: KnockoutSize,
  includeThirdPlace = false,
): KnockoutMatch[] {
  if (standings.length < knockoutSize) {
    // Not enough teams — fall back to whatever we have.
    knockoutSize = standings.length >= 4 ? 4 : 2;
  }

  if (knockoutSize === 2) {
    return [{
      stage: 'final', slot: 1,
      teamA: standings[0]?.teamId ?? null,
      teamB: standings[1]?.teamId ?? null,
      seedA: 1, seedB: 2,
    }];
  }

  // Top 4: #1 v #4, #2 v #3
  const bracket: KnockoutMatch[] = [
    { stage: 'semifinal', slot: 1, teamA: standings[0]?.teamId ?? null, teamB: standings[3]?.teamId ?? null, seedA: 1, seedB: 4 },
    { stage: 'semifinal', slot: 2, teamA: standings[1]?.teamId ?? null, teamB: standings[2]?.teamId ?? null, seedA: 2, seedB: 3 },
    { stage: 'final', slot: 1, teamA: null, teamB: null },
  ];
  if (includeThirdPlace) {
    bracket.push({ stage: 'third_place', slot: 1, teamA: null, teamB: null });
  }
  return bracket;
}

// Given the two semifinal results, return who advances to the final (and, if
// enabled, who drops to the third-place match). Winners feed the final; losers
// feed third place. Returns nulls where a semifinal isn't decided yet.
export interface SemiOutcome {
  finalTeamA: string | null;
  finalTeamB: string | null;
  thirdTeamA: string | null;
  thirdTeamB: string | null;
}

export function resolveSemifinals(
  semi1: { teamA: string | null; teamB: string | null; scoreA: number | null; scoreB: number | null },
  semi2: { teamA: string | null; teamB: string | null; scoreA: number | null; scoreB: number | null },
): SemiOutcome {
  const winner = (m: typeof semi1): string | null => {
    if (m.scoreA == null || m.scoreB == null || !m.teamA || !m.teamB) return null;
    return m.scoreA > m.scoreB ? m.teamA : m.teamB;
  };
  const loser = (m: typeof semi1): string | null => {
    if (m.scoreA == null || m.scoreB == null || !m.teamA || !m.teamB) return null;
    return m.scoreA > m.scoreB ? m.teamB : m.teamA;
  };
  return {
    finalTeamA: winner(semi1),
    finalTeamB: winner(semi2),
    thirdTeamA: loser(semi1),
    thirdTeamB: loser(semi2),
  };
}