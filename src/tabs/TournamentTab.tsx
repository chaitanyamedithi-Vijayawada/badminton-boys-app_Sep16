import { useState, useMemo, useEffect } from 'react';
import { Trophy, Plus, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useTournament, type MatchRow } from '../hooks/useTournament';
import { computeStandings, matchesRemaining, type TournamentTeam, type MatchResult, type ScheduledMatch } from '../lib/tournament';

// Distinct colors cycling through teams and rounds
const TEAM_COLORS = [
  '#f87171', '#fb923c', '#facc15', '#4ade80', '#34d399', '#22d3ee',
  '#60a5fa', '#a78bfa', '#f472b6', '#e879f9', '#fbbf24', '#2dd4bf',
  '#818cf8', '#fb7185', '#86efac', '#67e8f9',
];

const ROUND_COLORS: { bg: string; border: string; text: string }[] = [
  { bg: 'rgba(96,165,250,0.08)',  border: 'rgba(96,165,250,0.35)',  text: '#60a5fa' },
  { bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.35)',  text: '#4ade80' },
  { bg: 'rgba(250,204,21,0.08)',  border: 'rgba(250,204,21,0.35)',  text: '#facc15' },
  { bg: 'rgba(251,146,60,0.08)',  border: 'rgba(251,146,60,0.35)',  text: '#fb923c' },
  { bg: 'rgba(244,114,182,0.08)', border: 'rgba(244,114,182,0.35)', text: '#f472b6' },
  { bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.35)', text: '#a78bfa' },
  { bg: 'rgba(34,211,238,0.08)',  border: 'rgba(34,211,238,0.35)',  text: '#22d3ee' },
  { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.35)', text: '#f87171' },
  { bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.35)',  text: '#34d399' },
  { bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.35)',  text: '#fbbf24' },
];

const STAGE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  semifinal:   { bg: 'rgba(251,146,60,0.10)',  border: 'rgba(251,146,60,0.45)',  text: '#fb923c' },
  final:       { bg: 'rgba(250,204,21,0.10)',  border: 'rgba(250,204,21,0.50)',  text: '#facc15' },
  third_place: { bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.30)', text: '#94a3b8' },
};

export default function TournamentTab() {
  const { currentUser } = useApp();
  const isAdmin = currentUser?.role === 'admin';
  const { tournament, teams, matches, loading, createTournament, enterScore, startKnockout, resolveFinal, endTournament, renameTeam, resetScores, resetNames, resetKnockout, resetSemifinals, resetAllKeepNames } = useTournament();

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading tournament…</div>;
  }

  // No active tournament → setup screen (admin) or a friendly message (players).
  if (!tournament) {
    return isAdmin
      ? <TournamentSetup onCreate={createTournament} />
      : <div className="flex flex-col items-center justify-center h-64 gap-3 text-center px-6">
          <Trophy size={40} className="text-slate-600" />
          <p className="text-slate-400 text-sm">No tournament is running right now.</p>
        </div>;
  }

  return (
    <LiveTournament
      teams={teams}
      matches={matches}
      isAdmin={isAdmin}
      tournamentName={tournament.name}
      hasKnockout={tournament.format === 'round_robin_final'}
      onEnterScore={enterScore}
      onStartKnockout={startKnockout}
      onResolveFinal={resolveFinal}
      onEnd={endTournament}
      onRenameTeam={renameTeam}
      onResetScores={resetScores}
      onResetNames={resetNames}
      onResetKnockout={resetKnockout}
      onResetSemifinals={resetSemifinals}
      onResetAllKeepNames={resetAllKeepNames}
    />
  );
}

// ── Setup (admin only, when no tournament active) ─────────────────────────────
function TournamentSetup({ onCreate }: { onCreate: ReturnType<typeof useTournament>['createTournament'] }) {
  const [name, setName] = useState('Club Tournament');
  const [teamCount, setTeamCount] = useState(8);
  const [courtCount, setCourtCount] = useState(4);
  const [withFinal, setWithFinal] = useState(true);
  const [knockoutSize, setKnockoutSize] = useState<2 | 4>(4);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [teamNames, setTeamNames] = useState<string[]>(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setCount = (n: number) => {
    setTeamCount(n);
    setTeamNames(prev => {
      const next = [...prev];
      while (next.length < n) next.push(`Team ${next.length + 1}`);
      next.length = n;
      return next;
    });
  };

  const matchesTotal = (teamCount * (teamCount - 1)) / 2;

  const create = async () => {
    if (teamNames.some(t => !t.trim())) { setErr('Every team needs a name'); return; }
    setBusy(true); setErr(null);
    try {
      await onCreate({
        name: name.trim() || 'Tournament',
        teamNames: teamNames.map(t => t.trim()),
        courtCount,
        format: withFinal ? 'round_robin_final' : 'round_robin',
        knockoutSize,
        thirdPlace,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create');
    } finally { setBusy(false); }
  };

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    background: active ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
    color: active ? 'var(--accent-text)' : '#94a3b8',
    border: active ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
  });

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div className="flex items-center gap-2">
        <Trophy size={20} style={{ color: 'var(--accent)' }} />
        <h2 className="text-lg font-bold text-slate-100">New Tournament</h2>
      </div>

      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Tournament name"
        className="bg-white/[0.06] border border-violet-400/20 rounded-lg px-3 py-2.5 text-sm text-slate-100 outline-none"
      />

      <div>
        <p className="text-xs text-slate-400 mb-2">Teams: {teamCount} · {matchesTotal} round-robin matches</p>
        <div className="flex gap-1.5 flex-wrap">
          {[4, 5, 6, 7, 8, 9, 10, 12, 14, 16].map(n => (
            <button key={n} onClick={() => setCount(n)} style={chip(teamCount === n)}>{n}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-2">Courts</p>
        <div className="flex gap-1.5 flex-wrap">
          {[1, 2, 3, 4, 5, 6].map(n => (
            <button key={n} onClick={() => setCourtCount(n)} style={chip(courtCount === n)}>{n}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-2">Finals</p>
        <div className="flex gap-1.5 flex-wrap items-center">
          <button onClick={() => setWithFinal(false)} style={chip(!withFinal)}>Round-robin only</button>
          <button onClick={() => setWithFinal(true)} style={chip(withFinal)}>+ Knockout</button>
        </div>
        {withFinal && (
          <div className="flex gap-1.5 flex-wrap mt-2 items-center">
            <button onClick={() => setKnockoutSize(2)} style={chip(knockoutSize === 2)}>Top 2 (final)</button>
            <button onClick={() => setKnockoutSize(4)} style={chip(knockoutSize === 4)}>Top 4 (semis)</button>
            {knockoutSize === 4 && (
              <button onClick={() => setThirdPlace(p => !p)} style={chip(thirdPlace)}>
                {thirdPlace ? '✓ ' : ''}3rd-place match
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-2">Team names</p>
        <div className="flex flex-col gap-1.5">
          {teamNames.map((tn, i) => (
            <input
              key={i}
              value={tn}
              onChange={e => setTeamNames(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
              className="bg-white/[0.06] border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none"
            />
          ))}
        </div>
      </div>

      {err && <p className="text-xs text-orange-400">{err}</p>}

      <button
        onClick={create}
        disabled={busy}
        className="btn-gradient rounded-xl py-3 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Plus size={16} />
        {busy ? 'Creating…' : 'Create Tournament'}
      </button>
    </div>
  );
}

// ── Live view (everyone) ──────────────────────────────────────────────────────
function LiveTournament({
  teams, matches, isAdmin, tournamentName, hasKnockout, onEnterScore, onStartKnockout, onResolveFinal, onEnd, onRenameTeam, onResetScores, onResetNames, onResetKnockout, onResetSemifinals, onResetAllKeepNames,
}: {
  teams: { id: string; name: string }[];
  matches: MatchRow[];
  isAdmin: boolean;
  tournamentName: string;
  hasKnockout: boolean;
  onEnterScore: (id: string, a: number, b: number) => Promise<void>;
  onStartKnockout: (standingsOrder: string[]) => Promise<void>;
  onResolveFinal: () => Promise<void>;
  onEnd: () => Promise<void>;
  onRenameTeam: (teamId: string, newName: string) => Promise<void>;
  onResetScores: () => Promise<void>;
  onResetNames: () => Promise<void>;
  onResetKnockout: () => Promise<void>;
  onResetSemifinals: () => Promise<void>;
  onResetAllKeepNames: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'standings' | 'schedule'>('standings');
  const [autoResolving, setAutoResolving] = useState(false);
  const [autoStarting, setAutoStarting] = useState(false);

  const teamObjs: TournamentTeam[] = teams.map(t => ({ id: t.id, name: t.name }));
  const nameOf = (id: string) => teams.find(t => t.id === id)?.name ?? '—';
  // Stable color per team based on creation order
  const teamColorMap = useMemo(() =>
    new Map(teams.map((t, i) => [t.id, TEAM_COLORS[i % TEAM_COLORS.length]])),
    [teams]
  );

  const groupMatches = matches.filter(m => m.stage === 'group');
  const knockoutMatches = matches.filter(m => m.stage !== 'group');
  const schedule: ScheduledMatch[] = groupMatches.map(m => ({ round: m.round, court: m.court, teamA: m.team_a, teamB: m.team_b }));
  const results: MatchResult[] = groupMatches
    .filter(m => m.score_a != null && m.score_b != null)
    .map(m => ({ round: m.round, court: m.court, scoreA: m.score_a, scoreB: m.score_b }));

  const standings = useMemo(() => computeStandings(teamObjs, schedule, results), [teams, matches]);
  const groupRemaining = matchesRemaining(schedule, results);

  // Knockout state
  const semis = knockoutMatches.filter(m => m.stage === 'semifinal');
  const finalMatch = knockoutMatches.find(m => m.stage === 'final');
  const knockoutStarted = knockoutMatches.length > 0;
  const bothSemisScored = semis.length === 2 && semis.every(m => m.score_a != null && m.score_b != null);
  const finalNeedsTeams = finalMatch && (finalMatch.team_a === finalMatch.team_b); // placeholder not yet resolved
  const finalDone = finalMatch && finalMatch.score_a != null && finalMatch.score_b != null;

  // Auto-resolve the final once both semis are scored but the final still has
  // placeholder teams. Previously required a manual button click that was easy
  // to miss — now it fires automatically the moment the second semi is scored.
  useEffect(() => {
    if (bothSemisScored && finalNeedsTeams && !autoResolving) {
      setAutoResolving(true);
      onResolveFinal().finally(() => setAutoResolving(false));
    }
  }, [bothSemisScored, finalNeedsTeams, autoResolving, onResolveFinal]);

  // Auto-start the knockout stage once all group matches are scored. Previously
  // required a manual "Start Knockout Stage" button click — now it fires
  // automatically the moment the last group result is entered.
  useEffect(() => {
    if (hasKnockout && !knockoutStarted && groupRemaining === 0 && !autoStarting) {
      setAutoStarting(true);
      onStartKnockout(standings.map(s => s.teamId)).finally(() => setAutoStarting(false));
    }
  }, [hasKnockout, knockoutStarted, groupRemaining, autoStarting, onStartKnockout, standings]);

  // Champion, once decided.
  const champion = useMemo(() => {
    if (!finalDone || !finalMatch) return null;
    const winId = (finalMatch.score_a as number) > (finalMatch.score_b as number) ? finalMatch.team_a : finalMatch.team_b;
    return nameOf(winId);
  }, [finalDone, finalMatch, teams]);

  const rounds = useMemo(() => {
    const map = new Map<number, MatchRow[]>();
    matches.forEach(m => { const a = map.get(m.round) ?? []; a.push(m); map.set(m.round, a); });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={20} style={{ color: 'var(--accent)' }} />
          <h2 className="text-lg font-bold text-slate-100">{tournamentName}</h2>
        </div>
        {!knockoutStarted && <span className="text-xs text-slate-400">{groupRemaining} left</span>}
      </div>

      {/* Champion banner */}
      {champion && (
        <div className="rounded-xl p-4 text-center" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', border: '1px solid var(--accent)' }}>
          <Trophy size={28} style={{ color: 'var(--accent)' }} className="mx-auto mb-1" />
          <p className="text-xs uppercase tracking-widest text-slate-400">Champion</p>
          <p className="text-xl font-bold" style={{ color: 'var(--accent)' }}>{champion}</p>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => setTab('standings')} className={`flex-1 py-2 rounded-lg text-sm font-semibold ${tab === 'standings' ? 'btn-gradient text-white' : 'text-slate-400 bg-white/[0.04]'}`}>Standings</button>
        <button onClick={() => setTab('schedule')} className={`flex-1 py-2 rounded-lg text-sm font-semibold ${tab === 'schedule' ? 'btn-gradient text-white' : 'text-slate-400 bg-white/[0.04]'}`}>{knockoutStarted ? 'Bracket' : 'Schedule'}</button>
      </div>

      {tab === 'standings' ? (
        <>
        <div className="rounded-xl overflow-hidden border border-violet-400/15">
          <div className="grid grid-cols-[28px_1fr_32px_32px_44px] gap-1 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 bg-white/[0.03]">
            <span>#</span>
            <span className="flex items-center gap-1">
              Team
              {isAdmin && <span className="normal-case tracking-normal font-normal text-slate-600 ml-1">(tap to rename)</span>}
            </span>
            <span className="text-center">W</span><span className="text-center">L</span><span className="text-right">+/−</span>
          </div>
          {standings.map(s => {
            const tColor = teamColorMap.get(s.teamId) ?? '#94a3b8';
            return (
              <div
                key={s.teamId}
                className="grid grid-cols-[28px_1fr_32px_32px_44px] gap-1 px-3 py-2.5 text-sm border-t border-white/[0.04] items-center"
                style={{ borderLeft: `3px solid ${tColor}` }}
              >
                <span className="font-bold" style={{ color: tColor }}>{s.rank}</span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: tColor, boxShadow: `0 0 6px ${tColor}88` }}
                  />
                  <InlineNameEditor
                    name={s.name}
                    editable={isAdmin}
                    color={tColor}
                    onSave={name => onRenameTeam(s.teamId, name)}
                  />
                </span>
                <span className="text-center font-semibold" style={{ color: tColor }}>{s.wins}</span>
                <span className="text-center text-slate-400">{s.losses}</span>
                <span className={`text-right font-medium ${s.pointDiff > 0 ? 'text-emerald-400' : s.pointDiff < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {s.pointDiff > 0 ? '+' : ''}{s.pointDiff}
                </span>
              </div>
            );
          })}
          </div>

          {/* Knockout results summary — shows the semis/final scores on the
              standings view too, so you don't have to switch to the Bracket tab
              to see how the finals played out. */}
          {knockoutStarted && (
            <div className="mt-4 rounded-xl overflow-hidden border border-violet-400/15">
              <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 bg-white/[0.03]">
                Knockout results
              </div>
              {knockoutMatches
                .filter(m => m.stage === 'semifinal' || m.team_a !== m.team_b)
                .map(m => {
                  const done = m.score_a != null && m.score_b != null;
                  const aWon = done && (m.score_a as number) > (m.score_b as number);
                  const label = m.stage === 'final' ? 'Final' : m.stage === 'third_place' ? '3rd Place' : 'Semifinal';
                  const sc = STAGE_COLORS[m.stage] ?? STAGE_COLORS.final;
                  const isPlaceholder = m.team_a === m.team_b || (m.stage === 'semifinal' && groupRemaining > 0);
                  const colorA = isPlaceholder ? '#64748b' : (teamColorMap.get(m.team_a) ?? '#94a3b8');
                  const colorB = isPlaceholder ? '#64748b' : (teamColorMap.get(m.team_b) ?? '#94a3b8');
                  const nameA = isPlaceholder ? 'TBD' : nameOf(m.team_a);
                  const nameB = isPlaceholder ? 'TBD' : nameOf(m.team_b);
                  return (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-2.5 text-sm border-t border-white/[0.04]" style={{ borderLeft: `3px solid ${sc.border}` }}>
                      <span className="text-[10px] uppercase tracking-wider w-16 flex-shrink-0" style={{ color: sc.text }}>{label}</span>
                      <span className={`flex-1 truncate text-right font-semibold`} style={{ color: aWon ? colorA : '#94a3b8' }}>{nameA}</span>
                      <span className="font-bold text-slate-100 tabular-nums flex-shrink-0 px-1">
                        {done ? `${m.score_a} – ${m.score_b}` : 'vs'}
                      </span>
                      <span className="flex-1 truncate font-semibold" style={{ color: done && !aWon ? colorB : '#94a3b8' }}>{nameB}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          {rounds.map(([round, ms], roundIdx) => {
            const stage = ms[0].stage;
            const isGroup = stage === 'group';
            const color = isGroup
              ? ROUND_COLORS[roundIdx % ROUND_COLORS.length]
              : (STAGE_COLORS[stage] ?? STAGE_COLORS.final);
            const label = isGroup ? `Round ${round}` : stage === 'semifinal' ? 'Semifinals' : stage === 'final' ? 'Final' : '3rd Place';
            return (
              <div key={round}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: color.text, boxShadow: `0 0 8px ${color.text}99` }}
                  />
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: color.text }}>{label}</p>
                </div>
                <div className="flex flex-col gap-2">
                  {ms.map(m => {
                    const isPlaceholder = (m.stage === 'final' || m.stage === 'third_place') && m.team_a === m.team_b
                      || (m.stage === 'semifinal' && groupRemaining > 0);
                    return (
                    <MatchCard
                      key={m.id}
                      match={m}
                      nameA={isPlaceholder ? 'TBD' : nameOf(m.team_a)}
                      nameB={isPlaceholder ? 'TBD' : nameOf(m.team_b)}
                      colorA={isPlaceholder ? undefined : teamColorMap.get(m.team_a)}
                      colorB={isPlaceholder ? undefined : teamColorMap.get(m.team_b)}
                      roundColor={color}
                      isAdmin={isAdmin && !isPlaceholder}
                      onEnterScore={onEnterScore}
                    />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Auto-starting indicator — the knockout stage begins itself once
          all group matches are scored, but show a small note while in progress. */}
      {hasKnockout && !knockoutStarted && groupRemaining === 0 && (
        <p className="text-xs text-center text-slate-400 py-1">
          {autoStarting ? 'Starting knockout stage…' : 'Knockout stage will start shortly…'}
        </p>
      )}

      {/* Auto-resolving indicator — the final fills itself once both semis
          are scored, but show a small note while that's in progress. */}
      {bothSemisScored && finalNeedsTeams && (
        <p className="text-xs text-center text-slate-400 py-1">
          {autoResolving ? 'Resolving finalists…' : 'Finalists will be set shortly…'}
        </p>
      )}

      {isAdmin && (
        <div className="flex gap-2">
          <button
            onClick={() => { if (window.confirm('Reset ALL scores to blank? Team names and match pairings stay the same.')) onResetScores(); }}
            className="flex-1 py-2.5 rounded-xl border border-amber-600/40 text-amber-300 text-sm font-semibold hover:bg-amber-900/20 transition-colors"
          >
            Reset Scores
          </button>
          <button
            onClick={() => { if (window.confirm('Reset ALL team names back to defaults (Team 1, Team 2, ...)? Scores stay the same.')) onResetNames(); }}
            className="flex-1 py-2.5 rounded-xl border border-sky-600/40 text-sky-300 text-sm font-semibold hover:bg-sky-900/20 transition-colors"
          >
            Reset Names
          </button>
        </div>
      )}
      {isAdmin && knockoutStarted && (
        <button
          onClick={() => { if (window.confirm('Reset ALL knockout results (semifinals, final, 3rd place)? You can re-enter semifinal scores and re-resolve the final.')) onResetKnockout(); }}
          className="py-2.5 rounded-xl border border-rose-600/40 text-rose-300 text-sm font-semibold hover:bg-rose-900/20 transition-colors"
        >
          Reset Knockout Results
        </button>
      )}
      {isAdmin && knockoutStarted && (
        <button
          onClick={() => { if (window.confirm('Reset semifinal names and scores? Team names go back to defaults, semifinal scores are cleared, and the final/3rd-place matches are reset so you can re-resolve.')) onResetSemifinals(); }}
          className="py-2.5 rounded-xl border border-orange-600/40 text-orange-300 text-sm font-semibold hover:bg-orange-900/20 transition-colors"
        >
          Reset Semifinal Names & Scores
        </button>
      )}
      {isAdmin && (
        <button
          onClick={() => { if (window.confirm('Reset ALL scores and knockout results but KEEP team names? Everything goes back to blank so you can re-enter from scratch.')) onResetAllKeepNames(); }}
          className="py-2.5 rounded-xl border border-red-600/50 text-red-300 text-sm font-semibold hover:bg-red-900/20 transition-colors"
        >
          Reset Everything (Keep Names)
        </button>
      )}
      {isAdmin && (finalDone || (!hasKnockout && groupRemaining === 0)) && (
        <button onClick={() => { if (window.confirm('End this tournament?')) onEnd(); }}
          className="mt-2 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold">
          End tournament
        </button>
      )}
    </div>
  );
}

function MatchCard({
  match, nameA, nameB, colorA, colorB, roundColor, isAdmin, onEnterScore,
}: {
  match: MatchRow; nameA: string; nameB: string;
  colorA?: string; colorB?: string;
  roundColor?: { bg: string; border: string; text: string };
  isAdmin: boolean;
  onEnterScore: (id: string, a: number, b: number) => Promise<void>;
}) {
  const done = match.score_a != null && match.score_b != null;
  const [editing, setEditing] = useState(false);
  const [a, setA] = useState(match.score_a?.toString() ?? '');
  const [b, setB] = useState(match.score_b?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const winA = done && (match.score_a as number) > (match.score_b as number);
  const winB = done && (match.score_b as number) > (match.score_a as number);

  const cA = colorA ?? '#94a3b8';
  const cB = colorB ?? '#94a3b8';
  const rBorder = roundColor?.border ?? 'rgba(255,255,255,0.06)';
  const rBg = roundColor?.bg ?? 'rgba(255,255,255,0.04)';
  const rText = roundColor?.text ?? '#94a3b8';

  const save = async () => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (isNaN(na) || isNaN(nb)) return;
    setSaving(true);
    try { await onEnterScore(match.id, na, nb); setEditing(false); }
    finally { setSaving(false); }
  };

  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: rBg, border: `1px solid ${rBorder}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs w-10 flex-shrink-0" style={{ color: rText }}>Ct {match.court}</span>
        <div className="flex-1 flex items-center justify-between gap-2 min-w-0">
          <span
            className="text-sm truncate font-semibold"
            style={{ color: winA ? cA : done ? '#64748b' : cA, textShadow: winA ? `0 0 12px ${cA}66` : undefined }}
          >
            {nameA}
          </span>
          {editing ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              <input value={a} onChange={e => setA(e.target.value)} inputMode="numeric" className="w-10 text-center bg-white/[0.08] border border-violet-400/30 rounded px-1 py-0.5 text-sm text-slate-100 outline-none" />
              <span className="text-slate-500">–</span>
              <input value={b} onChange={e => setB(e.target.value)} inputMode="numeric" className="w-10 text-center bg-white/[0.08] border border-violet-400/30 rounded px-1 py-0.5 text-sm text-slate-100 outline-none" />
              <button onClick={save} disabled={saving} className="ml-1 text-emerald-400"><Check size={16} /></button>
            </div>
          ) : (
            <span className="text-sm font-bold text-slate-100 flex-shrink-0 tabular-nums">
              {done ? `${match.score_a} – ${match.score_b}` : 'vs'}
            </span>
          )}
          <span
            className="text-sm truncate text-right font-semibold"
            style={{ color: winB ? cB : done ? '#64748b' : cB, textShadow: winB ? `0 0 12px ${cB}66` : undefined }}
          >
            {nameB}
          </span>
        </div>
      </div>
      {isAdmin && !editing && (
        <button onClick={() => setEditing(true)} style={{ color: rText }} className="mt-1.5 text-[11px] opacity-70 hover:opacity-100">
          {done ? 'Edit score' : '+ Enter score'}
        </button>
      )}
    </div>
  );
}

// Inline team-name editor: shows as plain text for non-admins; admins can tap
// to edit and the name updates everywhere (standings, schedule, bracket) via DB.
function InlineNameEditor({
  name, editable, color, onSave,
}: {
  name: string;
  editable: boolean;
  color: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);

  // Keep local value in sync if external name changes (realtime update)
  useEffect(() => { if (!editing) setValue(name); }, [name, editing]);

  const commit = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) { setValue(name); setEditing(false); return; }
    setSaving(true);
    try { await onSave(trimmed); setEditing(false); }
    catch { setValue(name); }
    finally { setSaving(false); }
  };

  if (!editable) {
    return <span className="text-slate-100 truncate">{name}</span>;
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setValue(name); setEditing(false); } }}
        disabled={saving}
        className="bg-transparent border-b outline-none text-sm text-slate-100 w-full min-w-0"
        style={{ borderColor: color }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm text-slate-100 truncate text-left w-full group flex items-center gap-1"
      title="Tap to rename"
    >
      <span className="truncate">{name}</span>
      <svg width="10" height="10" viewBox="0 0 12 12" className="opacity-0 group-hover:opacity-60 flex-shrink-0 transition-opacity" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8.5 1.5l2 2-6 6H2.5v-2l6-6z" />
      </svg>
    </button>
  );
}