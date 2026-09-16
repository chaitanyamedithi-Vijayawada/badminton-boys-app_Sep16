import { Lock, Unlock, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { MatchRound } from '../../types';

interface RoundCardProps {
  round: MatchRound;
  isCurrentRound: boolean;
  isAdmin: boolean;
  onToggleLock: (roundNumber: number) => void;
  onSwapPlayers: (roundNumber: number, playerA: string, playerB: string) => void;
  onScoreChange?: (roundNumber: number, court: number, score1: number, score2: number) => void;
  allPlayingPlayers: string[];
  extraSwapPlayers?: string[];
  gamesPlayed: Record<string, number>;
  skillMap?: Record<string, string>;
}

// Aurora skill-tier palette: Expert = violet, Intermediate = teal,
// Beginner = amber, Guest = coral.
const TIER = {
  E: { dot: 'var(--accent)', label: 'Expert' },
  I: { dot: '#2dd4bf', label: 'Intermediate' },
  B: { dot: '#fbbf24', label: 'Beginner' },
  G: { dot: '#ff6f91', label: 'Guest' },
} as const;

function tierOf(skill?: string, isGuest?: boolean): keyof typeof TIER {
  if (isGuest) return 'G';
  if (skill === 'E' || skill === 'I' || skill === 'B') return skill;
  return 'B';
}

export default function RoundCard({
  round,
  isCurrentRound,
  isAdmin,
  onToggleLock,
  onSwapPlayers,
  onScoreChange,
  extraSwapPlayers,
  gamesPlayed,
  skillMap,
}: RoundCardProps) {
  const [expanded, setExpanded] = useState(isCurrentRound);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  const guestSet = new Set(extraSwapPlayers ?? []);

  const handlePlayerTap = (name: string) => {
    if (round.locked) return;
    if (selectedPlayer === name) {
      setSelectedPlayer(null);
      return;
    }
    if (selectedPlayer) {
      onSwapPlayers(round.roundNumber, selectedPlayer, name);
      setSelectedPlayer(null);
    } else {
      setSelectedPlayer(name);
    }
  };

  // A player chip placed on the court (keeps tap-to-swap behavior).
  const PlayerChip = ({ name, isBench = false }: { name: string; isBench?: boolean }) => {
    const t = TIER[tierOf(skillMap?.[name], guestSet.has(name))];
    const isSelected = selectedPlayer === name;
    const isSwapTarget = selectedPlayer && selectedPlayer !== name;

    return (
      <button
        onClick={() => handlePlayerTap(name)}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl border transition-all w-full ${
          isSelected
            ? ''
            : isSwapTarget
            ? 'bg-white/5 border-white/20 hover:border-violet-400/60 hover:bg-violet-900/20'
            : isBench
            ? 'bg-white/[0.03] border-white/10 opacity-70'
            : 'bg-white/[0.04] border-white/10 hover:border-white/25'
        }`}
        style={isSelected ? {
          background: 'color-mix(in srgb, var(--accent) 20%, transparent)',
          borderColor: 'var(--accent)',
          boxShadow: '0 0 8px color-mix(in srgb, var(--accent) 40%, transparent)',
        } : undefined}
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.dot }} />
        <span className={`text-xs font-medium truncate ${isBench ? 'text-slate-400' : 'text-slate-100'}`}>
          {name}
        </span>
        <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">{gamesPlayed[name] || 0}g</span>
      </button>
    );
  };

  return (
    <div className={`neon-card !rounded-xl ${isCurrentRound ? '!border-violet-700/50' : ''} mb-2`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer -m-4 p-4"
      >
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${isCurrentRound ? 'text-violet-400' : 'text-slate-300'}`}>
            Round {round.roundNumber}
          </span>
          {round.locked && <Lock size={12} className="text-amber-400" />}
          {isCurrentRound && (
            <span className="text-[10px] bg-violet-900/40 text-violet-400 px-2 py-0.5 rounded-full">Current</span>
          )}
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
      </button>

      {expanded && (
        <div className="pt-3 mt-3 border-t border-slate-800/40">

          {/* Swap hint */}
          {!round.locked && (
            <div className="text-[10px] text-slate-500 mb-3 text-center">
              {selectedPlayer
                ? `Swapping ${selectedPlayer} — tap another player to swap`
                : 'Tap any player to swap positions'}
            </div>
          )}

          {/* Courts (visual) */}
          {round.assignments.map((a, idx) => (
            <div key={idx} className="mb-3">
              <div className="text-[10px] text-slate-500 font-medium mb-1.5 px-0.5">Court {a.court}</div>
              <div
                className="relative rounded-xl border border-violet-400/15 p-2.5"
                style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), color-mix(in srgb, var(--accent-2) 5%, transparent))' }}
              >
                {/* Net */}
                <div
                  className="absolute top-2 bottom-2 left-1/2 -translate-x-1/2 border-l border-dashed"
                  style={{ borderColor: 'rgba(255,255,255,0.18)' }}
                />
                {/* VS badge over the net */}
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 text-[9px] font-bold text-violet-300 bg-[#1a1430] border border-violet-400/30 px-1.5 py-0.5 rounded-full">
                  VS
                </span>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 flex flex-col gap-1.5 pr-3">
                    <PlayerChip name={a.team1[0]} />
                    <PlayerChip name={a.team1[1]} />
                  </div>
                  <div className="flex-1 flex flex-col gap-1.5 pl-3">
                    <PlayerChip name={a.team2[0]} />
                    <PlayerChip name={a.team2[1]} />
                  </div>
                </div>
                {/* Score input */}
                <div className="flex items-center justify-center gap-2 mt-2.5 pt-2 border-t border-white/10">
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={a.score1 ?? ''}
                    onChange={(e) => onScoreChange?.(round.roundNumber, a.court, parseInt(e.target.value) || 0, a.score2 ?? 0)}
                    placeholder="0"
                    className="w-10 h-7 text-center text-sm font-bold text-slate-100 bg-white/[0.06] border border-violet-400/20 rounded-lg focus:outline-none focus:border-violet-400/50"
                  />
                  <span className="text-[10px] text-slate-500 font-semibold">:</span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={a.score2 ?? ''}
                    onChange={(e) => onScoreChange?.(round.roundNumber, a.court, a.score1 ?? 0, parseInt(e.target.value) || 0)}
                    placeholder="0"
                    className="w-10 h-7 text-center text-sm font-bold text-slate-100 bg-white/[0.06] border border-violet-400/20 rounded-lg focus:outline-none focus:border-violet-400/50"
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Bench / resting */}
          {(round.resting.length > 0 || (extraSwapPlayers ?? []).length > 0) && (
            <div className="rounded-xl px-3 py-2.5 mb-2 border border-white/10 bg-white/[0.03]">
              <div className="text-[10px] text-slate-400 font-medium mb-2">🪑 Resting</div>
              <div className="flex flex-wrap gap-1.5">
                {round.resting.map(p => (
                  <div key={p} className="w-[calc(50%-0.375rem)]">
                    <PlayerChip name={p} isBench />
                  </div>
                ))}
                {(extraSwapPlayers ?? []).map(p => (
                  <div key={p} className="w-[calc(50%-0.375rem)]">
                    <PlayerChip name={p} isBench />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tier legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 mb-1 text-[9.5px] text-slate-500">
            {(['E', 'I', 'B', 'G'] as const).map(k => (
              <span key={k} className="flex items-center gap-1">
                <i className="w-2 h-2 rounded-full inline-block" style={{ background: TIER[k].dot }} />
                {TIER[k].label}
              </span>
            ))}
          </div>

          {/* Admin controls */}
          {isAdmin && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { onToggleLock(round.roundNumber); setSelectedPlayer(null); }}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                  round.locked
                    ? 'border-amber-700/30 bg-amber-900/20 text-amber-400'
                    : 'border-slate-700/60 bg-slate-800/60 text-slate-400'
                }`}
              >
                {round.locked ? <><Unlock size={12} /> Unlock</> : <><Lock size={12} /> Lock</>}
              </button>
              {selectedPlayer && (
                <button
                  onClick={() => setSelectedPlayer(null)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-700/30 bg-red-900/20 text-red-400"
                >
                  Cancel swap
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}