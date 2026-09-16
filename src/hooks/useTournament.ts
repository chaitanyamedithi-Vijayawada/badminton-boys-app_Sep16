import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  generateRoundRobin,
  generateKnockout,
  resolveSemifinals,
  type TournamentTeam,
  type KnockoutSize,
} from '../lib/tournament';

export interface TournamentRow {
  id: string;
  name: string;
  format: 'round_robin' | 'round_robin_final';
  court_count: number;
  knockout_size: number;
  third_place: boolean;
  status: 'active' | 'completed';
}
export interface TeamRow { id: string; tournament_id: string; name: string; seed: number | null; }
export interface MatchRow {
  id: string; tournament_id: string; round: number; court: number;
  team_a: string; team_b: string; score_a: number | null; score_b: number | null;
  stage: 'group' | 'semifinal' | 'final' | 'third_place';
}

// Loads the single active tournament (if any) plus its teams and matches, and
// keeps them live via realtime. Everyone reads; admins call the action helpers.
export function useTournament() {
  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: tRows } = await supabase
      .from('tournaments').select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);
    const t = (tRows?.[0] as TournamentRow) ?? null;
    setTournament(t);
    if (!t) { setTeams([]); setMatches([]); setLoading(false); return; }

    const [{ data: teamRows }, { data: matchRows }] = await Promise.all([
      supabase.from('tournament_teams').select('*').eq('tournament_id', t.id).order('seed', { ascending: true }),
      supabase.from('tournament_matches').select('*').eq('tournament_id', t.id).order('round', { ascending: true }),
    ]);
    setTeams((teamRows as TeamRow[]) ?? []);
    setMatches((matchRows as MatchRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live sync — any change to teams/matches/tournaments reloads everything.
  useEffect(() => {
    const channel = supabase
      .channel('tournament_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_teams' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // ── Admin actions ───────────────────────────────────────────────────────────

  // Create a tournament: insert the tournament, its teams, then generate and
  // insert the round-robin match schedule.
  const createTournament = useCallback(async (opts: {
    name: string;
    teamNames: string[];
    courtCount: number;
    format: 'round_robin' | 'round_robin_final';
    knockoutSize: KnockoutSize;
    thirdPlace: boolean;
  }) => {
    const { data: tRows, error: tErr } = await supabase
      .from('tournaments')
      .insert({
        name: opts.name, format: opts.format, court_count: opts.courtCount,
        knockout_size: opts.knockoutSize, third_place: opts.thirdPlace, status: 'active',
      })
      .select();
    if (tErr || !tRows?.[0]) throw tErr ?? new Error('Create failed');
    const tid = tRows[0].id as string;

    const teamInserts = opts.teamNames.map((name, i) => ({ tournament_id: tid, name, seed: i + 1 }));
    const { data: teamRows, error: teamErr } = await supabase
      .from('tournament_teams').insert(teamInserts).select();
    if (teamErr || !teamRows) throw teamErr ?? new Error('Teams failed');

    const teamObjs: TournamentTeam[] = (teamRows as TeamRow[]).map(r => ({ id: r.id, name: r.name }));
    const schedule = generateRoundRobin(teamObjs, opts.courtCount);
    const matchInserts = schedule.map(m => ({
      tournament_id: tid, round: m.round, court: m.court,
      team_a: m.teamA, team_b: m.teamB, stage: 'group',
    }));
    const { error: mErr } = await supabase.from('tournament_matches').insert(matchInserts);
    if (mErr) throw mErr;
    await load();
  }, [load]);

  const enterScore = useCallback(async (matchId: string, scoreA: number, scoreB: number) => {
    const { error } = await supabase
      .from('tournament_matches')
      .update({ score_a: scoreA, score_b: scoreB })
      .eq('id', matchId);
    if (error) throw error;
  }, []);

  // Generate the knockout bracket from current standings and insert those matches.
  const startKnockout = useCallback(async (standingsOrder: string[]) => {
    if (!tournament) return;
    const size = (tournament.knockout_size === 2 ? 2 : 4) as KnockoutSize;
    const seeded = standingsOrder.map((teamId, i) => ({
      teamId, name: '', played: 0, wins: 0, losses: 0,
      pointsFor: 0, pointsAgainst: 0, pointDiff: 0, rank: i + 1,
    }));
    const bracket = generateKnockout(seeded, size, tournament.third_place);
    // Place knockout matches in rounds after the group stage.
    const maxRound = matches.reduce((m, x) => Math.max(m, x.round), 0);
    const inserts = bracket.map((b, i) => ({
      tournament_id: tournament.id,
      round: maxRound + 1 + (b.stage === 'final' || b.stage === 'third_place' ? 1 : 0),
      court: (i % tournament.court_count) + 1,
      team_a: b.teamA ?? seeded[0].teamId,   // semifinal slots have real teams; final TBD placeholder replaced on resolve
      team_b: b.teamB ?? seeded[0].teamId,
      stage: b.stage,
    }));
    const { error } = await supabase.from('tournament_matches').insert(inserts);
    if (error) throw error;
    await load();
  }, [tournament, matches, load]);

  // Once both semifinals are scored, fill the final's teams with the winners.
  const resolveFinal = useCallback(async () => {
    if (!tournament) return;
    const semis = matches.filter(m => m.stage === 'semifinal');
    const finalMatch = matches.find(m => m.stage === 'final');
    if (semis.length < 2 || !finalMatch) return;
    const [s1, s2] = semis;
    const out = resolveSemifinals(
      { teamA: s1.team_a, teamB: s1.team_b, scoreA: s1.score_a, scoreB: s1.score_b },
      { teamA: s2.team_a, teamB: s2.team_b, scoreA: s2.score_a, scoreB: s2.score_b },
    );
    const updates = [];
    if (out.finalTeamA && out.finalTeamB) {
      updates.push(supabase.from('tournament_matches')
        .update({ team_a: out.finalTeamA, team_b: out.finalTeamB })
        .eq('id', finalMatch.id));
    }
    const thirdMatch = matches.find(m => m.stage === 'third_place');
    if (thirdMatch && out.thirdTeamA && out.thirdTeamB) {
      updates.push(supabase.from('tournament_matches')
        .update({ team_a: out.thirdTeamA, team_b: out.thirdTeamB })
        .eq('id', thirdMatch.id));
    }
    const results = await Promise.all(updates);
    const firstErr = results.find(r => r.error);
    if (firstErr?.error) throw firstErr.error;
    await load();
  }, [tournament, matches, load]);

  const renameTeam = useCallback(async (teamId: string, newName: string) => {
    const { error } = await supabase
      .from('tournament_teams')
      .update({ name: newName.trim() })
      .eq('id', teamId);
    if (error) throw error;
    // realtime subscription will reload teams automatically
  }, []);

  const endTournament = useCallback(async () => {
    if (!tournament) return;
    await supabase.from('tournaments').update({ status: 'completed' }).eq('id', tournament.id);
    await load();
  }, [tournament, load]);

  // Clear all entered scores (group + knockout) so the admin can re-enter them.
  // Team names and match pairings stay intact.
  const resetScores = useCallback(async () => {
    if (!tournament) return;
    const { error } = await supabase
      .from('tournament_matches')
      .update({ score_a: null, score_b: null })
      .eq('tournament_id', tournament.id);
    if (error) throw error;
    await load();
  }, [tournament, load]);

  // Reset all team names back to their seeded defaults ("Team 1", "Team 2", ...).
  // Scores are unaffected - only the display names change.
  const resetNames = useCallback(async () => {
    if (!tournament) return;
    const updates = teams.map(t =>
      supabase.from('tournament_teams').update({ name: `Team ${t.seed ?? 1}` }).eq('id', t.id)
    );
    const results = await Promise.all(updates);
    const firstErr = results.find(r => r.error);
    if (firstErr?.error) throw firstErr.error;
    await load();
  }, [tournament, teams, load]);

  // Reset the knockout stage: clear semifinal/final/third-place scores and
  // restore the final and third-place matches to placeholder teams so the
  // admin can re-enter semifinal scores and re-resolve.
  const resetKnockout = useCallback(async () => {
    if (!tournament) return;
    const ko = matches.filter(m => m.stage !== 'group');
    if (ko.length === 0) return;
    const placeholder = teams[0]?.id ?? '';
    const updates = ko.map(m => {
      const isFinal = m.stage === 'final' || m.stage === 'third_place';
      const patch: Record<string, unknown> = { score_a: null, score_b: null };
      if (isFinal) { patch.team_a = placeholder; patch.team_b = placeholder; }
      return supabase.from('tournament_matches').update(patch).eq('id', m.id);
    });
    const results = await Promise.all(updates);
    const firstErr = results.find(r => r.error);
    if (firstErr?.error) throw firstErr.error;
    await load();
  }, [tournament, matches, teams, load]);

  // Reset only the semifinal matches: clear their scores, reset team names to
  // defaults, and reset the final/third-place matches to placeholders so the
  // admin can re-resolve. As described in the confirm dialog.
  const resetSemifinals = useCallback(async () => {
    if (!tournament) return;
    const semis = matches.filter(m => m.stage === 'semifinal');
    if (semis.length === 0) return;
    const placeholder = teams[0]?.id ?? '';
    const semiScoreUpdates = semis.map(m =>
      supabase.from('tournament_matches').update({ score_a: null, score_b: null }).eq('id', m.id)
    );
    const finalThird = matches.filter(m => m.stage === 'final' || m.stage === 'third_place');
    const finalUpdates = finalThird.map(m =>
      supabase.from('tournament_matches').update({ score_a: null, score_b: null, team_a: placeholder, team_b: placeholder }).eq('id', m.id)
    );
    const nameUpdates = teams.map(t =>
      supabase.from('tournament_teams').update({ name: `Team ${t.seed ?? 1}` }).eq('id', t.id)
    );
    const results = await Promise.all([...semiScoreUpdates, ...finalUpdates, ...nameUpdates]);
    const firstErr = results.find(r => r.error);
    if (firstErr?.error) throw firstErr.error;
    await load();
  }, [tournament, matches, teams, load]);

  // Reset everything EXCEPT team names: clear all scores (group + knockout)
  // and restore the final/third-place matches to placeholder teams so the
  // admin can re-enter from scratch.
  const resetAllKeepNames = useCallback(async () => {
    if (!tournament) return;
    const placeholder = teams[0]?.id ?? '';
    const ko = matches.filter(m => m.stage === 'final' || m.stage === 'third_place');
    const scoreReset = supabase
      .from('tournament_matches')
      .update({ score_a: null, score_b: null })
      .eq('tournament_id', tournament.id);
    const placeholderUpdates = ko.map(m =>
      supabase.from('tournament_matches').update({ team_a: placeholder, team_b: placeholder }).eq('id', m.id)
    );
    const results = await Promise.all([scoreReset, ...placeholderUpdates]);
    const firstErr = results.find(r => r.error);
    if (firstErr?.error) throw firstErr.error;
    await load();
  }, [tournament, matches, teams, load]);

  return {
    tournament, teams, matches, loading,
    createTournament, enterScore, startKnockout, resolveFinal, endTournament, renameTeam,
    resetScores, resetNames, resetKnockout, resetSemifinals, resetAllKeepNames,
    reload: load,
  };
}