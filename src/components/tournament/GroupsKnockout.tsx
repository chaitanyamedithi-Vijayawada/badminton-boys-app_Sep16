import { useMemo, useState } from 'react';
import { Trophy, Plus, Check, X, Medal, Users } from 'lucide-react';
import type { MatchRow, TeamRow, TournamentRow, useTournament } from '../../hooks/useTournament';
import {
  SAMPLE_TEAMS, TEAMS_PER_GROUP, QUALIFIERS_PER_GROUP, groupStandings, groupScoreProblem, seriesProblem,
  resolveBracket, podium, koTitle, simulateTestScores, type TestFill, type Group, type GTeam, type GMatch, type KoLabel, type KoResult, type KoResolved, type Game,
} from '../../lib/groupsKnockout';

const GROUP_COLOR: Record<Group, string> = { A: '#60a5fa', B: '#f472b6' };
const STAGE_COLOR: Record<string, string> = {
  quarterfinal: '#22d3ee', semifinal: '#fb923c', final: '#facc15', third_place: '#94a3b8',
};

// ── Setup ─────────────────────────────────────────────────────────────────────

export function GroupsSetup({ onCreate }: { onCreate: ReturnType<typeof useTournament>['createGroupsTournament'] }) {
  const blank = (g: Group) => Array.from({ length: TEAMS_PER_GROUP }, (_, i) => `${g}${i + 1}`);
  const [name, setName] = useState('Club Tournament');
  const [groups, setGroups] = useState<Record<Group, string[]>>({ A: blank('A'), B: blank('B') });
  const [semiBestOf, setSemiBestOf] = useState(1);
  const [finalBestOf, setFinalBestOf] = useState(3);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdBestOf, setThirdBestOf] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chip = (on: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600,
    background: on ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
    color: on ? 'var(--accent-text)' : '#94a3b8',
    border: on ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
  });

  const create = async () => {
    const all = [...groups.A, ...groups.B].map(t => t.trim());
    if (all.some(t => !t)) { setErr('Every team needs a name'); return; }
    if (new Set(all.map(t => t.toLowerCase())).size !== all.length) { setErr('Team names must be different'); return; }
    setBusy(true); setErr(null);
    try {
      await onCreate({
        name: name.trim() || 'Tournament',
        groups: { A: groups.A.map(t => t.trim()), B: groups.B.map(t => t.trim()) },
        semiBestOf, finalBestOf, thirdPlace, thirdBestOf,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create');
    } finally { setBusy(false); }
  };

  const BestOf = ({ value, set }: { value: number; set: (n: number) => void }) => (
    <div className="flex gap-1.5">
      <button onClick={() => set(1)} style={chip(value === 1)}>1 game</button>
      <button onClick={() => set(3)} style={chip(value === 3)}>Best of 3</button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Tournament name"
        className="bg-white/[0.06] border border-violet-400/20 rounded-lg px-3 py-2.5 text-sm text-slate-100 outline-none" />

      <div className="text-[11px] text-slate-400 bg-white/[0.03] border border-white/[0.06] rounded-lg p-2.5 leading-relaxed">
        12 teams in 2 groups of 6 · 6 rounds on 5 courts · group games to 21, no deuce ·
        top 4 of each group play cross-group quarterfinals (A1–B3, B1–A3, A2–B4, B2–A4), then semis and a final ·
        knockout games 21 win by 2, cap 30.
      </div>

      <button onClick={() => setGroups({ A: [...SAMPLE_TEAMS.A], B: [...SAMPLE_TEAMS.B] })}
        className="self-start text-xs font-semibold text-violet-200 bg-violet-900/30 border border-violet-500/30 rounded-lg px-3 py-1.5">
        <Users size={12} className="inline mr-1" aria-hidden="true" />Fill this Saturday's teams
      </button>

      {(['A', 'B'] as Group[]).map(g => (
        <div key={g}>
          <p className="text-xs font-bold mb-2" style={{ color: GROUP_COLOR[g] }}>Group {g}</p>
          <div className="flex flex-col gap-1.5">
            {groups[g].map((tn, i) => (
              <label key={i} className="flex items-center gap-2">
                <span className="w-7 text-xs font-bold" style={{ color: GROUP_COLOR[g] }}>{g}{i + 1}</span>
                <input value={tn}
                  onChange={e => setGroups(prev => ({ ...prev, [g]: prev[g].map((v, idx) => idx === i ? e.target.value : v) }))}
                  className="flex-1 bg-white/[0.06] border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none" />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-2.5">
        <div><p className="text-xs text-slate-400 mb-1.5">Semifinals</p><BestOf value={semiBestOf} set={setSemiBestOf} /></div>
        <div><p className="text-xs text-slate-400 mb-1.5">Final</p><BestOf value={finalBestOf} set={setFinalBestOf} /></div>
        <div>
          <p className="text-xs text-slate-400 mb-1.5">3rd-place match</p>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setThirdPlace(p => !p)} style={chip(thirdPlace)}>{thirdPlace ? '✓ Play it' : 'Skip it'}</button>
            {thirdPlace && <BestOf value={thirdBestOf} set={setThirdBestOf} />}
          </div>
        </div>
      </div>

      {err && <p className="text-xs text-orange-400">{err}</p>}

      <button onClick={create} disabled={busy}
        className="btn-gradient rounded-xl py-3 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        <Plus size={16} />{busy ? 'Creating…' : 'Create Tournament'}
      </button>
    </div>
  );
}

// ── Live view ─────────────────────────────────────────────────────────────────

export function GroupsLive({
  tournament, teams, matches, isAdmin, onEnterScore, onSaveKnockout, onClearKnockout, onArchive, onReset, onFillTest,
}: {
  tournament: TournamentRow;
  teams: TeamRow[];
  matches: MatchRow[];
  isAdmin: boolean;
  onEnterScore: (id: string, a: number, b: number) => Promise<void>;
  onSaveKnockout: (id: string, teamA: string, teamB: string, games: Game[], bestOf: number) => Promise<void>;
  onClearKnockout: (id: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onReset: () => Promise<void>;
  onFillTest: (fill: TestFill) => Promise<void>;
}) {
  const [tab, setTab] = useState<'groups' | 'schedule' | 'knockout'>('groups');
  const [filling, setFilling] = useState(false);
  const scoredCount = matches.filter(m => m.score_a != null || m.score_b != null).length;

  const gTeams: GTeam[] = useMemo(() => teams
    .filter(t => t.group_name === 'A' || t.group_name === 'B')
    .map(t => ({ id: t.id, name: t.name, group: t.group_name as Group, seed: t.seed ?? 0 })), [teams]);
  const nameOf = useMemo(() => {
    const m = new Map(gTeams.map(t => [t.id, t]));
    return (id: string | null) => (id ? m.get(id)?.name ?? '—' : 'TBD');
  }, [gTeams]);
  const tagOf = useMemo(() => {
    const m = new Map(gTeams.map(t => [t.id, `${t.group}${t.seed}`]));
    return (id: string | null) => (id ? m.get(id) ?? '' : '');
  }, [gTeams]);

  const groupMatches = matches.filter(m => m.stage === 'group');
  const koRows = matches.filter(m => m.label);

  const { standings, complete, remaining } = useMemo(() => {
    const standings = {} as Record<Group, ReturnType<typeof groupStandings>>;
    const complete = {} as Record<Group, boolean>;
    let remaining = 0;
    for (const g of ['A', 'B'] as Group[]) {
      const ms = groupMatches.filter(m => m.group_name === g);
      const gm: GMatch[] = ms.map(m => ({ teamA: m.team_a, teamB: m.team_b, scoreA: m.score_a, scoreB: m.score_b }));
      standings[g] = groupStandings(gTeams.filter(t => t.group === g), gm);
      const left = ms.filter(m => m.score_a == null || m.score_b == null).length;
      complete[g] = ms.length > 0 && left === 0;
      remaining += left;
    }
    return { standings, complete, remaining };
  }, [groupMatches, gTeams]);

  const bracket = useMemo(() => {
    const results: Partial<Record<KoLabel, KoResult>> = {};
    koRows.forEach(m => {
      if (m.games?.length) results[m.label as KoLabel] = { games: m.games, teamA: m.team_a ?? null, teamB: m.team_b ?? null };
    });
    return resolveBracket(standings, complete, results, {
      semi: tournament.semi_best_of ?? 1, final: tournament.final_best_of ?? 3, third: tournament.third_best_of ?? 1,
    }, tournament.third_place);
  }, [koRows, standings, complete, tournament]);

  const top = podium(bracket);
  // 3rd place: the 3rd-place match winner, or both semifinal losers (joint
  // bronze) when there is no 3rd-place match.
  const thirds = top.third
    ? [top.third]
    : bracket.filter(k => k.stage === 'semifinal' && k.loser).map(k => k.loser as string);
  const rowFor = (label: KoLabel) => koRows.find(m => m.label === label);

  const tabBtn = (on: boolean) =>
    `flex-1 py-2 rounded-lg text-sm font-semibold ${on ? 'btn-gradient text-white' : 'text-slate-400 bg-white/[0.04]'}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Trophy size={20} style={{ color: 'var(--accent)' }} />
          <h2 className="text-lg font-bold text-slate-100 truncate">{tournament.name}</h2>
        </div>
        <span className="text-xs text-slate-400 flex-shrink-0">
          {remaining > 0 ? `${remaining} group games left` : top.first ? 'Finished' : 'Knockout'}
        </span>
      </div>

      {top.first && (
        <div className="rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid var(--accent)' }}>
          <p className="text-xs uppercase tracking-widest text-slate-400 text-center mb-3">Winners</p>
          <div className="flex items-end justify-center gap-2">
            <PodiumSpot place={2} names={[nameOf(top.second)]} />
            <PodiumSpot place={1} names={[nameOf(top.first)]} />
            <PodiumSpot place={3} names={thirds.map(nameOf)} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => setTab('groups')} className={tabBtn(tab === 'groups')}>Groups</button>
        <button onClick={() => setTab('schedule')} className={tabBtn(tab === 'schedule')}>Schedule</button>
        <button onClick={() => setTab('knockout')} className={tabBtn(tab === 'knockout')}>Knockout</button>
      </div>

      {tab === 'groups' && (['A', 'B'] as Group[]).map(g => (
        <div key={g} className="rounded-xl overflow-hidden border border-white/10">
          <div className="px-3 py-2 text-xs font-bold flex justify-between" style={{ color: GROUP_COLOR[g], background: 'rgba(255,255,255,0.03)' }}>
            <span>Group {g}</span>
            <span className="text-slate-500 font-normal">{complete[g] ? 'Complete' : 'Top 4 go through'}</span>
          </div>
          <div className="grid grid-cols-[22px_1fr_22px_22px_22px_38px] gap-1 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            <span>#</span><span>Team</span><span className="text-center">P</span><span className="text-center">W</span><span className="text-center">L</span><span className="text-right">+/−</span>
          </div>
          {standings[g].map(s => {
            const through = s.rank <= QUALIFIERS_PER_GROUP;
            return (
              <div key={s.teamId}
                className="grid grid-cols-[22px_1fr_22px_22px_22px_38px] gap-1 px-3 py-2 text-sm border-t border-white/[0.04] items-center"
                style={{ borderLeft: `3px solid ${through ? GROUP_COLOR[g] : 'transparent'}` }}>
                <span className="font-bold" style={{ color: through ? GROUP_COLOR[g] : '#64748b' }}>{s.rank}</span>
                <span className="truncate text-slate-100">
                  <span className="text-[10px] text-slate-500 mr-1">{g}{s.seed}</span>{s.name}
                </span>
                <span className="text-center text-slate-400">{s.played}</span>
                <span className="text-center font-semibold text-slate-100">{s.wins}</span>
                <span className="text-center text-slate-400">{s.losses}</span>
                <span className={`text-right font-medium ${s.diff > 0 ? 'text-emerald-400' : s.diff < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {s.diff > 0 ? '+' : ''}{s.diff}
                </span>
              </div>
            );
          })}
          <div className="px-3 py-1.5 text-[10px] text-slate-500 border-t border-white/[0.04]">
            Ranked by wins, then head-to-head (two-way ties), then point difference.
          </div>
        </div>
      ))}

      {tab === 'schedule' && [1, 2, 3, 4, 5, 6].map(r => {
        const ms = groupMatches.filter(m => m.round === r).sort((a, b) => a.court - b.court);
        const resting = (['A', 'B'] as Group[]).flatMap(g => {
          const playing = new Set(ms.filter(m => m.group_name === g).flatMap(m => [m.team_a, m.team_b]));
          return gTeams.filter(t => t.group === g && !playing.has(t.id)).map(t => `${g}${t.seed}`);
        });
        return (
          <div key={r}>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
              Round {r}{resting.length > 0 && <span className="normal-case tracking-normal font-normal text-slate-500"> · resting {resting.join(', ')}</span>}
            </p>
            <div className="flex flex-col gap-2">
              {ms.map(m => (
                <GroupMatchCard key={m.id} match={m} isAdmin={isAdmin}
                  nameA={nameOf(m.team_a)} nameB={nameOf(m.team_b)}
                  tagA={tagOf(m.team_a)} tagB={tagOf(m.team_b)}
                  onSave={onEnterScore} />
              ))}
            </div>
          </div>
        );
      })}

      {tab === 'knockout' && (
        <div className="flex flex-col gap-4">
          {remaining > 0 && (
            <p className="text-xs text-slate-400 bg-white/[0.03] border border-white/[0.06] rounded-lg p-2.5">
              Quarterfinal teams fill in automatically when each group's games are all scored.
            </p>
          )}
          {(['quarterfinal', 'semifinal', 'final'] as const).map(stage => {
            const ms = bracket.filter(m => stage === 'final' ? (m.stage === 'final' || m.stage === 'third_place') : m.stage === stage);
            if (!ms.length) return null;
            const title = stage === 'quarterfinal' ? 'Quarterfinals' : stage === 'semifinal' ? 'Semifinals' : 'Final & 3rd place';
            return (
              <div key={stage}>
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: STAGE_COLOR[stage] }}>{title}</p>
                <div className="flex flex-col gap-2">
                  {ms.map(k => {
                    const row = rowFor(k.label);
                    return (
                      <KnockoutCard key={k.label} ko={k} rowId={row?.id ?? null} isAdmin={isAdmin}
                        nameOf={nameOf} tagOf={tagOf} onSave={onSaveKnockout} onClear={onClearKnockout} />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && !top.first && (
        <button
          disabled={filling}
          onClick={() => {
            if (!window.confirm('Fill every empty match with random test scores? Use this to try the format, then tap "Reset all scores" before the real event.')) return;
            const existing: Partial<Record<KoLabel, KoResult>> = {};
            koRows.forEach(m => { if (m.games?.length) existing[m.label as KoLabel] = { games: m.games, teamA: m.team_a ?? null, teamB: m.team_b ?? null }; });
            const fill = simulateTestScores(
              gTeams,
              groupMatches.map(m => ({ id: m.id, group: m.group_name as Group, teamA: m.team_a, teamB: m.team_b, scoreA: m.score_a, scoreB: m.score_b })),
              existing,
              { semi: tournament.semi_best_of ?? 1, final: tournament.final_best_of ?? 3, third: tournament.third_best_of ?? 1 },
              tournament.third_place,
            );
            setFilling(true);
            onFillTest(fill)
              .then(() => setTab('knockout'))
              .catch(e => window.alert(`Test fill failed: ${e?.message ?? e}`))
              .finally(() => setFilling(false));
          }}
          className="mt-2 py-2.5 rounded-xl border border-amber-400/50 text-amber-300 text-sm font-semibold disabled:opacity-50">
          {filling ? 'Filling test scores…' : 'Fill test scores (try the format)'}
        </button>
      )}

      {isAdmin && scoredCount > 0 && (
        <button
          onClick={() => {
            if (!window.confirm(`Clear all ${scoredCount} scores? Use this after a test run. Teams and fixtures stay; the knockout goes back to TBD. This can't be undone.`)) return;
            const typed = window.prompt('Type RESET to confirm');
            if (typed?.trim().toUpperCase() !== 'RESET') return;
            void onReset().catch(e => window.alert(`Reset failed: ${e?.message ?? e}`));
          }}
          className="mt-2 py-2.5 rounded-xl border border-red-500/50 text-red-300 text-sm font-semibold">
          Reset all scores (after a test)
        </button>
      )}

      {isAdmin && (
        <button
          onClick={() => { if (window.confirm('Finish this tournament and set up a new one? Its results are kept, just no longer shown here.')) void onArchive(); }}
          className="mt-2 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold">
          {top.first ? 'Finish tournament' : 'Finish & start a new tournament'}
        </button>
      )}
    </div>
  );
}

const MEDAL: Record<1 | 2 | 3, { fill: string; rim: string; label: string; height: string }> = {
  1: { fill: '#facc15', rim: '#a16207', label: 'Champions', height: 'pt-0' },
  2: { fill: '#e2e8f0', rim: '#64748b', label: 'Runners-up', height: 'pt-5' },
  3: { fill: '#f59e0b', rim: '#9a3412', label: '3rd place', height: 'pt-8' },
};

function MedalIcon({ place, size = 44 }: { place: 1 | 2 | 3; size?: number }) {
  const m = MEDAL[place];
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 40 50" aria-hidden="true">
      <path d="M10 0h8l6 16h-8z" fill="#3b82f6" />
      <path d="M30 0h-8l-6 16h8z" fill="#ef4444" />
      <circle cx="20" cy="32" r="15" fill={m.rim} />
      <circle cx="20" cy="32" r="12" fill={m.fill} />
      <text x="20" y="37.5" textAnchor="middle" fontSize="15" fontWeight="800" fill={m.rim}>{place}</text>
    </svg>
  );
}

function PodiumSpot({ place, names }: { place: 1 | 2 | 3; names: string[] }) {
  const m = MEDAL[place];
  if (names.length === 0) return null;
  return (
    <div className={`flex-1 min-w-0 flex flex-col items-center text-center ${m.height}`}>
      <MedalIcon place={place} size={place === 1 ? 52 : 40} />
      <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">{m.label}</p>
      {names.map(n => (
        <p key={n} className={`font-bold leading-tight ${place === 1 ? 'text-base' : 'text-xs'}`}
          style={{ color: place === 1 ? 'var(--accent)' : '#e2e8f0' }}>{n}</p>
      ))}
    </div>
  );
}

function ScoreInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
      inputMode="numeric" aria-label={label}
      className="w-11 text-center bg-white/[0.08] border border-violet-400/30 rounded px-1 py-1 text-sm text-slate-100 outline-none" />
  );
}

function GroupMatchCard({ match, nameA, nameB, tagA, tagB, isAdmin, onSave }: {
  match: MatchRow; nameA: string; nameB: string; tagA: string; tagB: string; isAdmin: boolean;
  onSave: (id: string, a: number, b: number) => Promise<void>;
}) {
  const done = match.score_a != null && match.score_b != null;
  const [editing, setEditing] = useState(false);
  const [a, setA] = useState(match.score_a?.toString() ?? '');
  const [b, setB] = useState(match.score_b?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const g = (match.group_name ?? 'A') as Group;
  const winA = done && (match.score_a as number) > (match.score_b as number);
  const winB = done && (match.score_b as number) > (match.score_a as number);

  const save = async () => {
    const na = Number(a), nb = Number(b);
    if (a === '' || b === '') return;
    const problem = groupScoreProblem(na, nb);
    if (problem && !window.confirm(`${problem}.\n\nSave ${na}–${nb} anyway?`)) return;
    setSaving(true);
    try { await onSave(match.id, na, nb); setEditing(false); }
    catch { window.alert('Could not save the score. Check your connection and try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl px-3 py-2.5 bg-white/[0.04]" style={{ border: `1px solid ${GROUP_COLOR[g]}33` }}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] w-11 flex-shrink-0 font-semibold" style={{ color: GROUP_COLOR[g] }}>Ct {match.court}</span>
        <span className={`flex-1 min-w-0 truncate text-sm font-semibold ${winA ? 'text-slate-50' : done ? 'text-slate-500' : 'text-slate-200'}`}>
          <span className="text-[10px] text-slate-500 mr-1">{tagA}</span>{nameA}
        </span>
        {editing ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <ScoreInput value={a} onChange={setA} label={`${nameA} score`} />
            <span className="text-slate-500">–</span>
            <ScoreInput value={b} onChange={setB} label={`${nameB} score`} />
          </div>
        ) : (
          <span className="text-sm font-bold text-slate-100 flex-shrink-0 tabular-nums">{done ? `${match.score_a} – ${match.score_b}` : 'vs'}</span>
        )}
        <span className={`flex-1 min-w-0 truncate text-right text-sm font-semibold ${winB ? 'text-slate-50' : done ? 'text-slate-500' : 'text-slate-200'}`}>
          {nameB}<span className="text-[10px] text-slate-500 ml-1">{tagB}</span>
        </span>
      </div>
      {isAdmin && (
        <div className="mt-1.5 flex justify-end gap-3">
          {editing ? (
            <>
              <button onClick={() => { setEditing(false); setA(match.score_a?.toString() ?? ''); setB(match.score_b?.toString() ?? ''); }}
                className="text-[11px] text-slate-400 flex items-center gap-1"><X size={12} />Cancel</button>
              <button onClick={save} disabled={saving} className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                <Check size={12} />{saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="text-[11px] text-violet-300 opacity-80 hover:opacity-100">
              {done ? 'Edit score' : '+ Enter score'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KnockoutCard({ ko, rowId, isAdmin, nameOf, tagOf, onSave, onClear }: {
  ko: KoResolved; rowId: string | null; isAdmin: boolean;
  nameOf: (id: string | null) => string; tagOf: (id: string | null) => string;
  onSave: (id: string, teamA: string, teamB: string, games: Game[], bestOf: number) => Promise<void>;
  onClear: (id: string) => Promise<void>;
}) {
  const ready = !!ko.teamA && !!ko.teamB;
  const played = ko.games.length > 0;
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<[string, string][]>([]);
  const [saving, setSaving] = useState(false);
  const color = STAGE_COLOR[ko.stage];

  const startEdit = () => {
    const base: [string, string][] = ko.games.map(([a, b]) => [String(a), String(b)]);
    while (base.length < ko.bestOf) base.push(['', '']);
    setRows(base);
    setEditing(true);
  };

  const save = async () => {
    if (!rowId || !ko.teamA || !ko.teamB) return;
    const games: Game[] = rows.filter(([a, b]) => a !== '' && b !== '').map(([a, b]) => [Number(a), Number(b)]);
    const problem = seriesProblem(games, ko.bestOf);
    if (problem && !window.confirm(`${problem}.\n\nSave anyway?`)) return;
    if (!games.length) return;
    setSaving(true);
    try { await onSave(rowId, ko.teamA, ko.teamB, games, ko.bestOf); setEditing(false); }
    catch { window.alert('Could not save the result. Check your connection and try again.'); }
    finally { setSaving(false); }
  };

  const side = (id: string | null, source: string, won: boolean) => (
    <div className={`text-sm font-semibold truncate ${won ? 'text-slate-50' : played ? 'text-slate-500' : 'text-slate-200'}`}>
      {ready ? <><span className="text-[10px] text-slate-500 mr-1">{tagOf(id)}</span>{nameOf(id)}</> : <span className="text-slate-500">{id ? nameOf(id) : source}</span>}
      {won && <Medal size={12} className="inline ml-1 text-amber-300" aria-label="winner" />}
    </div>
  );

  return (
    <div className="rounded-xl px-3 py-2.5 bg-white/[0.04]" style={{ border: `1px solid ${color}44` }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold" style={{ color }}>{koTitle(ko.label)}</span>
        <span className="text-[10px] text-slate-500">Court {ko.court} · {ko.bestOf === 1 ? '1 game' : `best of ${ko.bestOf}`}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {side(ko.teamA, ko.sourceA, !!ko.winner && ko.winner === ko.teamA)}
        <span className="text-sm font-bold text-slate-100 tabular-nums text-center">
          {played ? (ko.bestOf === 1 ? `${ko.games[0][0]} – ${ko.games[0][1]}` : `${ko.winsA} – ${ko.winsB}`) : 'vs'}
        </span>
        <div className="text-right">{side(ko.teamB, ko.sourceB, !!ko.winner && ko.winner === ko.teamB)}</div>
      </div>
      {played && ko.bestOf > 1 && (
        <p className="text-[11px] text-slate-400 text-center mt-1">{ko.games.map(([a, b]) => `${a}–${b}`).join(', ')}</p>
      )}
      {!ready && <p className="text-[10px] text-slate-500 mt-1">{ko.sourceA} vs {ko.sourceB}</p>}
      {ko.stale && (
        <p className="text-[11px] text-amber-300 mt-1">
          An earlier score changed, so different teams now meet here. {ready ? 'Please re-enter this result.' : ''}
        </p>
      )}

      {editing && (
        <div className="mt-2 flex flex-col gap-1.5">
          {rows.map(([a, b], i) => (
            <div key={i} className="flex items-center justify-center gap-1.5">
              <span className="text-[10px] text-slate-500 w-12">Game {i + 1}</span>
              <ScoreInput value={a} onChange={v => setRows(r => r.map((x, j) => j === i ? [v, x[1]] : x))} label={`Game ${i + 1} ${nameOf(ko.teamA)}`} />
              <span className="text-slate-500">–</span>
              <ScoreInput value={b} onChange={v => setRows(r => r.map((x, j) => j === i ? [x[0], v] : x))} label={`Game ${i + 1} ${nameOf(ko.teamB)}`} />
            </div>
          ))}
          {ko.bestOf > 1 && <p className="text-[10px] text-slate-500 text-center">Leave game 3 empty if it wasn't needed.</p>}
        </div>
      )}

      {isAdmin && ready && rowId && (
        <div className="mt-1.5 flex justify-end gap-3">
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} className="text-[11px] text-slate-400 flex items-center gap-1"><X size={12} />Cancel</button>
              <button onClick={save} disabled={saving} className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                <Check size={12} />{saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              {played && (
                <button onClick={() => { if (window.confirm(`Clear the ${koTitle(ko.label)} result?`)) void onClear(rowId); }}
                  className="text-[11px] text-rose-300 opacity-80 hover:opacity-100">Clear</button>
              )}
              <button onClick={startEdit} className="text-[11px] text-violet-300 opacity-80 hover:opacity-100">
                {played ? 'Edit result' : '+ Enter result'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
