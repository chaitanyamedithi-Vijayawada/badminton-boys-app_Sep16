import type { MatchAssignment, MatchRound } from '../types';

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function groupKey(players: string[]): string {
  return [...players].sort().join('::');
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function skillScore(p: string, skillMap: Record<string, string>): number {
  const s = skillMap[p];
  if (s === 'B') return 0;
  if (s === 'I') return 1;
  if (s === 'E') return 2;
  return 1;
}

function skillTier(p: string, skillMap: Record<string, string>): 'E' | 'I' | 'B' | 'U' {
  const s = skillMap[p];
  if (s === 'E') return 'E';
  if (s === 'I') return 'I';
  if (s === 'B') return 'B';
  return 'U';
}

// Pair scoring:
// - Mix phase (rounds 1-5): E+B is actively rewarded (best mixing)
// - Skill phase (rounds 6+): E+B is neutral (0) — separation enforced via hard penalty elsewhere
function pairScore(
  p1: string,
  p2: string,
  skillMap: Record<string, string>,
  isFreeMix: boolean
): number {
  const t1 = skillTier(p1, skillMap);
  const t2 = skillTier(p2, skillMap);

  if ((t1 === 'E' && t2 === 'B') || (t1 === 'B' && t2 === 'E')) return isFreeMix ? 10 : 0;
  if ((t1 === 'E' && t2 === 'I') || (t1 === 'I' && t2 === 'E')) return 6;
  if ((t1 === 'I' && t2 === 'B') || (t1 === 'B' && t2 === 'I')) return 6;
  if (t1 === 'I' && t2 === 'I') return 3;
  if (t1 === t2) return 0; // E+E or B+B
  return 4; // Fallback for 'U'
}

// Pick the most balanced team split from 4 players
function buildBalancedTeams(
  courtPlayers: string[],
  skillMap: Record<string, string>,
  isFreeMix: boolean
): { team1: [string, string]; team2: [string, string] } {
  const [a, b, c, d] = courtPlayers;
  const pairings = [
    { team1: [a, b] as [string, string], team2: [c, d] as [string, string] },
    { team1: [a, c] as [string, string], team2: [b, d] as [string, string] },
    { team1: [a, d] as [string, string], team2: [b, c] as [string, string] },
  ];

  pairings.sort((x, y) => {
    const sx =
      pairScore(x.team1[0], x.team1[1], skillMap, isFreeMix) +
      pairScore(x.team2[0], x.team2[1], skillMap, isFreeMix);
    const sy =
      pairScore(y.team1[0], y.team1[1], skillMap, isFreeMix) +
      pairScore(y.team2[0], y.team2[1], skillMap, isFreeMix);
    return sy - sx; // descending
  });

  return { team1: pairings[0].team1, team2: pairings[0].team2 };
}

function scoreCandidateRound(
  assignments: MatchAssignment[],
  resting: string[],
  partnerHistory: Record<string, number>,
  opponentHistory: Record<string, number>,
  courtGroupHistory: Record<string, number>,
  restCount: Record<string, number>,
  gamesPlayed: Record<string, number>,
  totalPlayers: number,
  courtCapacity: number,
  isFreeMixRound: boolean,
  skillMap: Record<string, string>
): number {
  let penalty = 0;

  for (const a of assignments) {
    const pk1 = pairKey(a.team1[0], a.team1[1]);
    const pk2 = pairKey(a.team2[0], a.team2[1]);
    penalty += (partnerHistory[pk1] || 0) * 20;
    penalty += (partnerHistory[pk2] || 0) * 20;

    const opponents = [
      pairKey(a.team1[0], a.team2[0]), pairKey(a.team1[0], a.team2[1]),
      pairKey(a.team1[1], a.team2[0]), pairKey(a.team1[1], a.team2[1]),
    ];
    for (const ok of opponents) penalty += (opponentHistory[ok] || 0) * 8;

    const gk = groupKey([...a.team1, ...a.team2]);
    penalty += (courtGroupHistory[gk] || 0) * 25;

    // Skill phase: nuclear penalty for E+B on same court
    // Forces scheduler to never mix E and B unless mathematically impossible
    if (!isFreeMixRound) {
      const courtPlayers = [...a.team1, ...a.team2];
      const hasE = courtPlayers.some(p => skillTier(p, skillMap) === 'E');
      const hasB = courtPlayers.some(p => skillTier(p, skillMap) === 'B');
      if (hasE && hasB) {
        penalty += 5000;
      }
    }
  }

  const fairRestShare =
    totalPlayers > courtCapacity
      ? Math.floor(((totalPlayers - courtCapacity) / totalPlayers) * 10) / 10
      : 0;

  for (const p of resting) {
    const extraRest = (restCount[p] || 0) - fairRestShare;
    if (extraRest > 0) penalty += extraRest * 5;
  }

  const minGames = Math.min(...Object.values(gamesPlayed), 999);
  for (const p of resting) {
    if ((gamesPlayed[p] || 0) <= minGames) penalty += 10;
  }

  return penalty;
}

// Sit-out selection.
//   equalPlay = true  (Free Mix): everyone is equal — whoever has played the
//     most games sits next (ties: fewest previous rests). Skill tier and guest
//     status are IGNORED, so beginners/guests get the same amount of play.
//   equalPlay = false (Skill phase): strict tier priority — Guests first, then
//     B, then I, then E (experts rest last). Within a tier, most games rests next.
function selectResting(
  players: string[],
  needToRest: number,
  restCount: Record<string, number>,
  gamesPlayed: Record<string, number>,
  skillMap: Record<string, string>,
  guestSet: Set<string>,
  equalPlay = false
): { resting: string[]; active: string[] } {
  if (needToRest <= 0) return { resting: [], active: [...players] };

  const tierOrder = (p: string): number => {
    if (guestSet.has(p)) return 1;
    const tier = skillTier(p, skillMap);
    if (tier === 'B') return 2;
    if (tier === 'I') return 3;
    if (tier === 'E') return 4;
    return 3; // unranked non-guests treated as Intermediate
  };

  const sorted = [...players].sort((a, b) => {
    if (!equalPlay) {
      const ta = tierOrder(a);
      const tb = tierOrder(b);
      if (ta !== tb) return ta - tb;
    }
    // Fairness: player with more games played rests first…
    const gpDiff = (gamesPlayed[b] || 0) - (gamesPlayed[a] || 0);
    if (gpDiff !== 0) return gpDiff;
    // …then player with fewer previous rests rests next.
    return (restCount[a] || 0) - (restCount[b] || 0);
  });

  return { resting: sorted.slice(0, needToRest), active: sorted.slice(needToRest) };
}

function generateCandidateRound(
  players: string[],
  courts: number[],
  restCount: Record<string, number>,
  gamesPlayed: Record<string, number>,
  skillMap: Record<string, string>,
  isFreeMixRound: boolean,
  guestSet: Set<string>
): { assignments: MatchAssignment[]; resting: string[] } {
  const courtCapacity = courts.length * 4;
  const needToRest = Math.max(0, players.length - courtCapacity);

  // Free Mix: everyone gets equal play. Rest is chosen purely by fairness
  // (most games-played sits next), ignoring skill tier and guest status, so
  // beginners and guests are no longer benched far more than strong players.
  const { resting, active: activePlayers } = selectResting(
    players, needToRest, restCount, gamesPlayed, skillMap, guestSet, true
  );

  const assignments: MatchAssignment[] = [];

  if (isFreeMixRound) {
    // Mix phase (rounds 1-5): fully random courts, balanced teams internally
    const shuffled = shuffle(activePlayers);
    for (let i = 0; i < courts.length; i++) {
      const courtPlayers = shuffled.slice(i * 4, i * 4 + 4);
      if (courtPlayers.length < 4) break;
      const { team1, team2 } = buildBalancedTeams(courtPlayers, skillMap, true);
      assignments.push({ court: courts[i], team1, team2 });
    }
  } else {
    // Skill phase (rounds 6+): sort by skill level descending (E → I → B)
    // 5000 penalty in scorer enforces strict E/B separation.
    // Shuffle within groups across 1000 iterations for partner/opponent variety.
    const bySkill = [...activePlayers].sort(
      (a, b) => skillScore(b, skillMap) - skillScore(a, skillMap)
    );

    for (let i = 0; i < courts.length; i++) {
      const courtGroup = bySkill.slice(i * 4, i * 4 + 4);
      if (courtGroup.length < 4) break;
      const shuffledCourtPlayers = shuffle(courtGroup);
      const { team1, team2 } = buildBalancedTeams(shuffledCourtPlayers, skillMap, false);
      assignments.push({ court: courts[i], team1, team2 });
    }
  }

  return { assignments, resting };
}



function generateSkillCandidateRound(
  players: string[],
  courts: number[],
  restCount: Record<string, number>,
  gamesPlayed: Record<string, number>,
  skillMap: Record<string, string>,
): { assignments: MatchAssignment[]; resting: string[] } {
  const courtCapacity = courts.length * 4;
  const needToRest = Math.max(0, players.length - courtCapacity);

  const sorted = [...players].sort((a, b) => {
    const restDiff = (restCount[b] || 0) - (restCount[a] || 0);
    if (restDiff !== 0) return restDiff;
    const skillDiff = skillScore(a, skillMap) - skillScore(b, skillMap);
    if (skillDiff !== 0) return skillDiff;
    return (gamesPlayed[b] || 0) - (gamesPlayed[a] || 0);
  });

  const resting = sorted.slice(0, needToRest);
  const active = sorted.slice(needToRest);

  const ePool = shuffle(active.filter(p => skillMap[p] === 'E'));
  const iPool = shuffle(active.filter(p => skillMap[p] === 'I'));
  const bPool = shuffle(active.filter(p => skillMap[p] === 'B'));
  const unranked = shuffle(active.filter(p => !skillMap[p]));
  const iExtended = [...iPool, ...unranked];

  const assignments: MatchAssignment[] = [];

  for (let i = 0; i < courts.length; i++) {
    let t1p1 = '', t1p2 = '', t2p1 = '', t2p2 = '';

    // Team 1: E+I preferred, then E+E, then E+B
    if (ePool.length > 0 && iExtended.length > 0) {
      t1p1 = ePool.shift()!;
      t1p2 = iExtended.shift()!;
    } else if (ePool.length >= 2) {
      t1p1 = ePool.shift()!;
      t1p2 = ePool.shift()!;
    } else if (ePool.length > 0 && bPool.length > 0) {
      t1p1 = ePool.shift()!;
      t1p2 = bPool.shift()!;
    } else if (iExtended.length >= 2) {
      t1p1 = iExtended.shift()!;
      t1p2 = iExtended.shift()!;
    } else if (bPool.length >= 2) {
      t1p1 = bPool.shift()!;
      t1p2 = bPool.shift()!;
    } else {
      const remaining = [...ePool, ...iExtended, ...bPool];
      t1p1 = remaining.shift() || '';
      t1p2 = remaining.shift() || '';
    }

    // Team 2: I+I, I+B, B+B (avoid E)
    if (iExtended.length >= 2) {
      t2p1 = iExtended.shift()!;
      t2p2 = iExtended.shift()!;
    } else if (iExtended.length > 0 && bPool.length > 0) {
      t2p1 = iExtended.shift()!;
      t2p2 = bPool.shift()!;
    } else if (bPool.length >= 2) {
      t2p1 = bPool.shift()!;
      t2p2 = bPool.shift()!;
    } else if (ePool.length >= 2) {
      t2p1 = ePool.shift()!;
      t2p2 = ePool.shift()!;
    } else {
      const remaining = [...ePool, ...iExtended, ...bPool];
      t2p1 = remaining.shift() || '';
      t2p2 = remaining.shift() || '';
    }

    if (t1p1 && t1p2 && t2p1 && t2p2) {
      assignments.push({ court: courts[i], team1: [t1p1, t1p2], team2: [t2p1, t2p2] });
    }
  }

  return { assignments, resting };
}

export function generateSkillRound(
  players: string[],
  courts: number[],
  existingRounds: MatchRound[],
  partnerHistory: Record<string, number>,
  opponentHistory: Record<string, number>,
  restCount: Record<string, number>,
  gamesPlayed: Record<string, number>,
  skillMap: Record<string, string> = {},
): MatchRound {
  const roundNumber = existingRounds.length + 1;

  if (players.length < 4) {
    return { roundNumber, assignments: [], resting: [...players], locked: false };
  }

  const courtCapacity = courts.length * 4;
  let bestCandidate: { assignments: MatchAssignment[]; resting: string[] } | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < 100; i++) {
    const candidate = generateSkillCandidateRound(players, courts, restCount, gamesPlayed, skillMap);
    const score = scoreCandidateRound(
      candidate.assignments, candidate.resting,
      partnerHistory, opponentHistory,
      {}, // courtGroupHistory — empty for skill rounds
      restCount, gamesPlayed,
      players.length, courtCapacity,
      false, // isFreeMixRound
      skillMap,
    );
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return {
    roundNumber,
    assignments: bestCandidate?.assignments ?? [],
    resting: bestCandidate?.resting ?? [],
    locked: false,
  };
}

export function generateNextRound(
  players: string[],
  courts: number[],
  existingRounds: MatchRound[],
  partnerHistory: Record<string, number>,
  opponentHistory: Record<string, number>,
  restCount: Record<string, number>,
  gamesPlayed: Record<string, number>,
  skillMap: Record<string, string> = {},
  guestNames: string[] = [],
  forceSkillPhase = false,  // admin can trigger skill phase early
): MatchRound {
  const roundNumber = existingRounds.length + 1;
  const courtCapacity = courts.length * 4;

  // Mix phase: rounds 1-5 (or until admin forces skill phase early)
  const isFreeMixRound = !forceSkillPhase && roundNumber <= 5;

  const guestSet = new Set(guestNames);

  // Main players first, guests fill remaining spots
  const orderedPlayers = [...players];

  if (orderedPlayers.length < 4) {
    return { roundNumber, assignments: [], resting: [...orderedPlayers], locked: false };
  }

  const courtGroupHistory: Record<string, number> = {};
  for (const round of existingRounds) {
    for (const a of round.assignments) {
      const gk = groupKey([...a.team1, ...a.team2]);
      courtGroupHistory[gk] = (courtGroupHistory[gk] || 0) + 1;
    }
  }

  let bestCandidate: { assignments: MatchAssignment[]; resting: string[] } | null = null;
  let bestScore = Infinity;

  // 1000 iterations — brute-forces optimal setup for up to 20 players
  for (let i = 0; i < 1000; i++) {
    const candidate = generateCandidateRound(
      orderedPlayers, courts, restCount, gamesPlayed, skillMap, isFreeMixRound, guestSet
    );
    const score = scoreCandidateRound(
      candidate.assignments, candidate.resting,
      partnerHistory, opponentHistory, courtGroupHistory,
      restCount, gamesPlayed, orderedPlayers.length, courtCapacity,
      isFreeMixRound, skillMap
    );

    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return {
    roundNumber,
    assignments: bestCandidate?.assignments ?? [],
    resting: bestCandidate?.resting ?? [],
    locked: false,
  };
}

export function updateTrackingFromRound(
  round: MatchRound,
  gamesPlayed: Record<string, number>,
  restCount: Record<string, number>,
  partnerHistory: Record<string, number>,
  opponentHistory: Record<string, number>,
): {
  gamesPlayed: Record<string, number>;
  restCount: Record<string, number>;
  partnerHistory: Record<string, number>;
  opponentHistory: Record<string, number>;
} {
  const gp = { ...gamesPlayed };
  const rc = { ...restCount };
  const ph = { ...partnerHistory };
  const oh = { ...opponentHistory };

  for (const a of round.assignments) {
    for (const p of [...a.team1, ...a.team2]) gp[p] = (gp[p] || 0) + 1;
    const pk1 = pairKey(a.team1[0], a.team1[1]);
    const pk2 = pairKey(a.team2[0], a.team2[1]);
    ph[pk1] = (ph[pk1] || 0) + 1;
    ph[pk2] = (ph[pk2] || 0) + 1;
    const opponents = [
      pairKey(a.team1[0], a.team2[0]), pairKey(a.team1[0], a.team2[1]),
      pairKey(a.team1[1], a.team2[0]), pairKey(a.team1[1], a.team2[1]),
    ];
    for (const ok of opponents) oh[ok] = (oh[ok] || 0) + 1;
  }
  for (const p of round.resting) rc[p] = (rc[p] || 0) + 1;

  return { gamesPlayed: gp, restCount: rc, partnerHistory: ph, opponentHistory: oh };
}

export function rebuildTrackingFromRounds(
  rounds: MatchRound[],
  allPlayers: string[],
): {
  gamesPlayed: Record<string, number>;
  restCount: Record<string, number>;
  partnerHistory: Record<string, number>;
  opponentHistory: Record<string, number>;
} {
  let gamesPlayed: Record<string, number> = {};
  let restCount: Record<string, number> = {};
  let partnerHistory: Record<string, number> = {};
  let opponentHistory: Record<string, number> = {};

  for (const p of allPlayers) { gamesPlayed[p] = 0; restCount[p] = 0; }

  for (const round of rounds) {
    const updated = updateTrackingFromRound(round, gamesPlayed, restCount, partnerHistory, opponentHistory);
    gamesPlayed = updated.gamesPlayed;
    restCount = updated.restCount;
    partnerHistory = updated.partnerHistory;
    opponentHistory = updated.opponentHistory;
  }

  return { gamesPlayed, restCount, partnerHistory, opponentHistory };
}

export function formatRoundText(
  round: MatchRound,
  sessionName: string,
  dateStr: string,
  playerCount: number,
  courts: number[],
): string {
  const lines: string[] = [];
  lines.push(sessionName);
  lines.push(dateStr);
  lines.push(`Players: ${playerCount} | Courts: ${courts.join(', ')}`);
  lines.push('');
  lines.push(`Round ${round.roundNumber}`);
  for (const a of round.assignments) {
    lines.push(`Court ${a.court}: ${a.team1[0]} + ${a.team1[1]} vs ${a.team2[0]} + ${a.team2[1]}`);
  }
  if (round.resting.length > 0) lines.push(`Resting: ${round.resting.join(', ')}`);
  return lines.join('\n');
}

export function formatFullScheduleText(
  rounds: MatchRound[],
  sessionName: string,
  dateStr: string,
  playerCount: number,
  courts: number[],
  gamesPlayed: Record<string, number>,
): string {
  const lines: string[] = [];
  lines.push(sessionName);
  lines.push(dateStr);
  lines.push(`Players: ${playerCount} | Courts: ${courts.join(', ')}`);
  lines.push('');
  for (const round of rounds) {
    lines.push(`Round ${round.roundNumber}`);
    for (const a of round.assignments) {
      lines.push(`Court ${a.court}: ${a.team1[0]} + ${a.team1[1]} vs ${a.team2[0]} + ${a.team2[1]}`);
    }
    if (round.resting.length > 0) lines.push(`Resting: ${round.resting.join(', ')}`);
    lines.push('');
  }
  lines.push('Games Played Summary:');
  const entries = Object.entries(gamesPlayed).sort(([, a], [, b]) => b - a);
  lines.push(entries.map(([name, count]) => `${name}: ${count}`).join(' | '));
  return lines.join('\n');
}