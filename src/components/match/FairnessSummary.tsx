import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

interface FairnessSummaryProps {
  gamesPlayed: Record<string, number>;
  restCount: Record<string, number>;
  partnerHistory: Record<string, number>;
  opponentHistory: Record<string, number>;
  players: string[];
}

export default function FairnessSummary({
  gamesPlayed,
  restCount,
  partnerHistory,
  opponentHistory,
  players,
}: FairnessSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  if (players.length === 0) return null;

  const gamesArr = players.map(p => gamesPlayed[p] || 0);
  const restArr = players.map(p => restCount[p] || 0);
  const maxGames = Math.max(...gamesArr);
  const minGames = Math.min(...gamesArr);
  const maxRest = Math.max(...restArr);
  const minRest = Math.min(...restArr);
  const gameImbalance = maxGames - minGames > 1;
  const restImbalance = maxRest - minRest > 2;

  const topPartners = Object.entries(partnerHistory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const topOpponents = Object.entries(opponentHistory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="neon-card !rounded-xl mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer -m-4 p-4"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-300">Fairness Summary</span>
          {(gameImbalance || restImbalance) && <AlertTriangle size={12} className="text-amber-400" />}
        </div>
        {expanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
      </button>

      {expanded && (
        <div className="pt-3 mt-3 border-t border-slate-800/40 space-y-3">
          <div>
            <div className="text-[10px] text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Games Played</div>
            <div className="grid grid-cols-3 gap-1">
              {players.map(p => {
                const gp = gamesPlayed[p] || 0;
                const isLow = gp === minGames && gameImbalance;
                return (
                  <div key={p} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${isLow ? 'bg-amber-900/20 text-amber-400' : 'bg-slate-800/60 text-slate-300'}`}>
                    <span className="truncate mr-1">{p}</span>
                    <span className="font-semibold">{gp}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Rest Count</div>
            <div className="grid grid-cols-3 gap-1">
              {players.map(p => {
                const rc = restCount[p] || 0;
                const isHigh = rc === maxRest && restImbalance;
                return (
                  <div key={p} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${isHigh ? 'bg-red-900/20 text-red-400' : 'bg-slate-800/60 text-slate-300'}`}>
                    <span className="truncate mr-1">{p}</span>
                    <span className="font-semibold">{rc}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {topPartners.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Top Partner Pairs</div>
              <div className="space-y-1">
                {topPartners.map(([key, count]) => {
                  const [a, b] = key.split('::');
                  return (
                    <div key={key} className="flex items-center justify-between text-xs bg-slate-800/60 px-2 py-1 rounded">
                      <span className="text-slate-300">{a} + {b}</span>
                      <span className="font-semibold text-slate-400">{count}x</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {topOpponents.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Top Opponent Pairs</div>
              <div className="space-y-1">
                {topOpponents.map(([key, count]) => {
                  const [a, b] = key.split('::');
                  return (
                    <div key={key} className="flex items-center justify-between text-xs bg-slate-800/60 px-2 py-1 rounded">
                      <span className="text-slate-300">{a} vs {b}</span>
                      <span className="font-semibold text-slate-400">{count}x</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
