import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Play, ListOrdered, RotateCcw, AlertTriangle, Users, LayoutGrid } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { generateNextRound, generateSkillRound, updateTrackingFromRound, rebuildTrackingFromRounds } from '../lib/matchScheduler';
import { formatDate, getNextWeekday } from '../lib/constants';
import { useWaitlist } from '../hooks/useWaitlist';
import type { MatchRound, Day } from '../types';
import RoundCard from '../components/match/RoundCard';
import FairnessSummary from '../components/match/FairnessSummary';
import ExportMenu from '../components/match/ExportMenu';
import DownloadPDF from '../components/match/DownloadPDF';

export default function MatchTab() {
  const { guestData, courtData, pinVerified, showToast, players, currentUser, myName, settings } = useApp();

  const [activeDay, setActiveDay] = useState<Day>('saturday');
  const [scheduleMode, setScheduleMode] = useState<'mix' | 'skill'>('mix');

  // Free Mix state
  const [rounds, setRounds] = useState<MatchRound[]>([]);
  const [totalRoundsSetting, setTotalRoundsSetting] = useState(10);
  const [gamesPlayed, setGamesPlayed] = useState<Record<string, number>>({});
  const [restCount, setRestCount] = useState<Record<string, number>>({});
  const [partnerHistory, setPartnerHistory] = useState<Record<string, number>>({});
  const [opponentHistory, setOpponentHistory] = useState<Record<string, number>>({});
  const [playerSnapshot, setPlayerSnapshot] = useState<string[]>([]);

  // Skill Match state
  const [skillRounds, setSkillRounds] = useState<MatchRound[]>([]);
  const [skillGamesPlayed, setSkillGamesPlayed] = useState<Record<string, number>>({});
  const [skillRestCount, setSkillRestCount] = useState<Record<string, number>>({});
  const [skillPartnerHistory, setSkillPartnerHistory] = useState<Record<string, number>>({});
  const [skillOpponentHistory, setSkillOpponentHistory] = useState<Record<string, number>>({});
  const [skillPlayerSnapshot, setSkillPlayerSnapshot] = useState<string[]>([]);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPlayerChangePrompt, setShowPlayerChangePrompt] = useState(false);
  const [forceSkillPhase, setForceSkillPhase] = useState(false);
  const playerChangeAction = useRef<'keep' | 'reset' | null>(null);

  // Admin detection for destructive actions (Reset). Generation controls (Next
  // Round, Full Schedule) are available to all logged-in users since they're
  // non-destructive in-memory actions.
  const isAdmin = (() => {
    if (pinVerified) return true;
    if (currentUser?.role === 'admin') return true;
    if (!myName) return false;
    const a1 = (settings.admin1 || 'Eswar').toUpperCase();
    const a2 = (settings.admin2 || 'Arun').toUpperCase();
    return [a1, a2].includes(myName.toUpperCase());
  })();

  const guests = guestData[activeDay] ?? [];
  const courts = courtData[activeDay];

  // Waitlist-aware — the match scheduler only sees accepted attendees.
  // Waitlisted people don't play, so shouldn't be in match generation.
  const wait = useWaitlist(activeDay);
  const activePlayers = useMemo(() => {
    return wait.accepted.map(a => a.name);
  }, [wait.accepted]);

  const guestNames = useMemo(
    () => wait.accepted.filter(a => a.isGuest).map(a => a.name),
    [wait.accepted]
  );

  const skillMap = useMemo(() => {
    const map: Record<string, string> = {};
    // Regular players (exclude archived)
    players.filter(p => !p.archived).forEach(p => {
      if (p.skill) map[p.name] = p.skill;
    });
    // Guests — use their level from guestData (only for accepted guests)
    guests.forEach(g => {
      if (g.level && guestNames.includes(g.name)) map[g.name] = g.level;
    });
    return map;
  }, [players, guests, guestNames]);

  const courtCapacity = courts.length * 4;
  const needsSchedule = activePlayers.length > courtCapacity;
  const enoughPlayers = activePlayers.length >= 4;

  const date = activeDay === 'saturday' ? getNextWeekday(6) : getNextWeekday(2);
  const dateStr = formatDate(date);
  const sessionName = `Badminton Boys - ${activeDay.charAt(0).toUpperCase() + activeDay.slice(1)}`;

  const prevPlayersRef = useRef<string[]>([]);
  useEffect(() => {
    if (rounds.length === 0) {
      prevPlayersRef.current = activePlayers;
      return;
    }
    const prevSet = new Set(playerSnapshot);
    const currSet = new Set(activePlayers);
    const changed = activePlayers.length !== playerSnapshot.length ||
      activePlayers.some(p => !prevSet.has(p)) ||
      playerSnapshot.some(p => !currSet.has(p));
    if (changed && rounds.length > 0) setShowPlayerChangePrompt(true);
    prevPlayersRef.current = activePlayers;
  }, [activePlayers, playerSnapshot, rounds.length]);

  const handlePlayerChangeDecision = useCallback((action: 'keep' | 'reset') => {
    playerChangeAction.current = action;
    setShowPlayerChangePrompt(false);
    if (action === 'reset') {
      setRounds([]);
      const gp: Record<string, number> = {};
      const rc: Record<string, number> = {};
      activePlayers.forEach(p => { gp[p] = 0; rc[p] = 0; });
      setGamesPlayed(gp);
      setRestCount(rc);
      setPartnerHistory({});
      setOpponentHistory({});
      setPlayerSnapshot([]);
      showToast('Schedule reset for new player list');
    } else {
      const frozenRounds = rounds.filter(r => r.locked);
      const tracking = rebuildTrackingFromRounds(frozenRounds, activePlayers);
      setRounds(frozenRounds);
      setGamesPlayed(tracking.gamesPlayed);
      setRestCount(tracking.restCount);
      setPartnerHistory(tracking.partnerHistory);
      setOpponentHistory(tracking.opponentHistory);
      setPlayerSnapshot(activePlayers);
      showToast('Keeping locked rounds, adjusting future rounds');
    }
  }, [activePlayers, rounds, showToast]);

  const initTracking = useCallback(() => {
    const gp: Record<string, number> = {};
    const rc: Record<string, number> = {};
    activePlayers.forEach(p => { gp[p] = 0; rc[p] = 0; });
    setGamesPlayed(gp);
    setRestCount(rc);
    setPartnerHistory({});
    setOpponentHistory({});
    setPlayerSnapshot([...activePlayers]);
  }, [activePlayers]);

  // ── Free Mix handlers ─────────────────────────────────────────────────────
  const handleGenerateNextRound = useCallback(() => {
    if (!enoughPlayers) { showToast('At least 4 players are needed'); return; }
    if (rounds.length === 0) initTracking();
    const currentPlayers = rounds.length === 0 ? activePlayers : playerSnapshot.length > 0 ? playerSnapshot : activePlayers;
    const newRound = generateNextRound(
      currentPlayers, courts, rounds,
      rounds.length === 0 ? {} : partnerHistory,
      rounds.length === 0 ? {} : opponentHistory,
      rounds.length === 0 ? Object.fromEntries(currentPlayers.map(p => [p, 0])) : restCount,
      rounds.length === 0 ? Object.fromEntries(currentPlayers.map(p => [p, 0])) : gamesPlayed,
      skillMap, guestNames, forceSkillPhase,
    );
    const updated = updateTrackingFromRound(
      newRound,
      rounds.length === 0 ? Object.fromEntries(currentPlayers.map(p => [p, 0])) : gamesPlayed,
      rounds.length === 0 ? Object.fromEntries(currentPlayers.map(p => [p, 0])) : restCount,
      rounds.length === 0 ? {} : partnerHistory,
      rounds.length === 0 ? {} : opponentHistory,
    );
    setRounds(prev => [...prev, newRound]);
    setGamesPlayed(updated.gamesPlayed);
    setRestCount(updated.restCount);
    setPartnerHistory(updated.partnerHistory);
    setOpponentHistory(updated.opponentHistory);
    if (rounds.length === 0) setPlayerSnapshot([...currentPlayers]);
  }, [enoughPlayers, rounds, activePlayers, playerSnapshot, courts, partnerHistory, opponentHistory, restCount, gamesPlayed, initTracking, showToast, skillMap, guestNames, forceSkillPhase]);

  const handlePrepareFullSchedule = useCallback(() => {
    if (!enoughPlayers) { showToast('At least 4 players are needed'); return; }
    const currentPlayers = [...activePlayers];
    let gp: Record<string, number> = {};
    let rc: Record<string, number> = {};
    let ph: Record<string, number> = {};
    let oh: Record<string, number> = {};
    currentPlayers.forEach(p => { gp[p] = 0; rc[p] = 0; });
    const allRounds: MatchRound[] = [];
    for (let i = 0; i < totalRoundsSetting; i++) {
      const newRound = generateNextRound(currentPlayers, courts, allRounds, ph, oh, rc, gp, skillMap, guestNames, forceSkillPhase || i >= 5);
      allRounds.push(newRound);
      const updated = updateTrackingFromRound(newRound, gp, rc, ph, oh);
      gp = updated.gamesPlayed; rc = updated.restCount; ph = updated.partnerHistory; oh = updated.opponentHistory;
    }
    setRounds(allRounds); setGamesPlayed(gp); setRestCount(rc); setPartnerHistory(ph); setOpponentHistory(oh);
    setPlayerSnapshot(currentPlayers);
    showToast(`Generated ${totalRoundsSetting} rounds`);
  }, [enoughPlayers, activePlayers, courts, totalRoundsSetting, showToast, skillMap, guestNames, forceSkillPhase]);

  const handleReset = useCallback(() => setShowResetConfirm(true), []);

  const confirmReset = useCallback(() => {
    setRounds([]); setGamesPlayed({}); setRestCount({}); setPartnerHistory({}); setOpponentHistory({});
    setPlayerSnapshot([]); setForceSkillPhase(false); setShowResetConfirm(false);
    showToast('Schedule reset');
  }, [showToast]);

  const handleToggleLock = useCallback((roundNumber: number) => {
    setRounds(prev => prev.map(r => r.roundNumber === roundNumber ? { ...r, locked: !r.locked } : r));
  }, []);

  const handleSwapPlayers = useCallback((roundNumber: number, playerA: string, playerB: string) => {
    setRounds(prev => prev.map(r => {
      if (r.roundNumber !== roundNumber) return r;
      const newAssignments = r.assignments.map(a => ({
        ...a,
        team1: a.team1.map(p => p === playerA ? playerB : p === playerB ? playerA : p) as [string, string],
        team2: a.team2.map(p => p === playerA ? playerB : p === playerB ? playerA : p) as [string, string],
      }));
      const newResting = r.resting.map(p => p === playerA ? playerB : p === playerB ? playerA : p);
      return { ...r, assignments: newAssignments, resting: newResting };
    }));
    showToast(`Swapped ${playerA} ↔ ${playerB}`);
  }, [showToast]);

  // ── Skill Match handlers ──────────────────────────────────────────────────
  const handleGenerateSkillRound = useCallback(() => {
    if (!enoughPlayers) { showToast('At least 4 players needed'); return; }
    const currentPlayers = (skillRounds.length === 0 ? activePlayers : skillPlayerSnapshot.length > 0 ? skillPlayerSnapshot : activePlayers).filter(p => !guestNames.includes(p));
    if (skillRounds.length === 0) {
      const gp: Record<string, number> = {};
      const rc: Record<string, number> = {};
      currentPlayers.forEach(p => { gp[p] = 0; rc[p] = 0; });
      setSkillGamesPlayed(gp); setSkillRestCount(rc); setSkillPartnerHistory({}); setSkillOpponentHistory({});
      setSkillPlayerSnapshot([...currentPlayers]);
    }
    const newRound = generateSkillRound(
      currentPlayers, courts, skillRounds,
      skillRounds.length === 0 ? {} : skillPartnerHistory,
      skillRounds.length === 0 ? {} : skillOpponentHistory,
      skillRounds.length === 0 ? Object.fromEntries(currentPlayers.map(p => [p, 0])) : skillRestCount,
      skillRounds.length === 0 ? Object.fromEntries(currentPlayers.map(p => [p, 0])) : skillGamesPlayed,
      skillMap,
    );
    const updated = updateTrackingFromRound(
      newRound,
      skillRounds.length === 0 ? Object.fromEntries(currentPlayers.map(p => [p, 0])) : skillGamesPlayed,
      skillRounds.length === 0 ? Object.fromEntries(currentPlayers.map(p => [p, 0])) : skillRestCount,
      skillRounds.length === 0 ? {} : skillPartnerHistory,
      skillRounds.length === 0 ? {} : skillOpponentHistory,
    );
    setSkillRounds(prev => [...prev, newRound]);
    setSkillGamesPlayed(updated.gamesPlayed); setSkillRestCount(updated.restCount);
    setSkillPartnerHistory(updated.partnerHistory); setSkillOpponentHistory(updated.opponentHistory);
    if (skillRounds.length === 0) setSkillPlayerSnapshot([...currentPlayers]);
  }, [enoughPlayers, skillRounds, activePlayers, skillPlayerSnapshot, courts, skillPartnerHistory, skillOpponentHistory, skillRestCount, skillGamesPlayed, skillMap, showToast]);

  const handlePrepareFullSkillSchedule = useCallback(() => {
    if (!enoughPlayers) { showToast('At least 4 players needed'); return; }
    const currentPlayers = activePlayers.filter(p => !guestNames.includes(p));
    let gp: Record<string, number> = {};
    let rc: Record<string, number> = {};
    let ph: Record<string, number> = {};
    let oh: Record<string, number> = {};
    currentPlayers.forEach(p => { gp[p] = 0; rc[p] = 0; });
    const allRounds: MatchRound[] = [];
    for (let i = 0; i < totalRoundsSetting; i++) {
      const newRound = generateSkillRound(currentPlayers, courts, allRounds, ph, oh, rc, gp, skillMap);
      allRounds.push(newRound);
      const updated = updateTrackingFromRound(newRound, gp, rc, ph, oh);
      gp = updated.gamesPlayed; rc = updated.restCount; ph = updated.partnerHistory; oh = updated.opponentHistory;
    }
    setSkillRounds(allRounds); setSkillGamesPlayed(gp); setSkillRestCount(rc);
    setSkillPartnerHistory(ph); setSkillOpponentHistory(oh); setSkillPlayerSnapshot(currentPlayers);
    showToast(`Generated ${totalRoundsSetting} skill rounds`);
  }, [enoughPlayers, activePlayers, courts, totalRoundsSetting, skillMap, showToast]);

  const handleResetSkill = useCallback(() => {
    setSkillRounds([]); setSkillGamesPlayed({}); setSkillRestCount({});
    setSkillPartnerHistory({}); setSkillOpponentHistory({}); setSkillPlayerSnapshot([]);
    showToast('Skill schedule reset');
  }, [showToast]);

  const handleSwapSkillPlayers = useCallback((roundNumber: number, playerA: string, playerB: string) => {
    setSkillRounds(prev => prev.map(r => {
      if (r.roundNumber !== roundNumber) return r;
      const newAssignments = r.assignments.map(a => ({
        ...a,
        team1: a.team1.map(p => p === playerA ? playerB : p === playerB ? playerA : p) as [string, string],
        team2: a.team2.map(p => p === playerA ? playerB : p === playerB ? playerA : p) as [string, string],
      }));
      const newResting = r.resting.map(p => p === playerA ? playerB : p === playerB ? playerA : p);
      return { ...r, assignments: newAssignments, resting: newResting };
    }));
    showToast(`Swapped ${playerA} ↔ ${playerB}`);
  }, [showToast]);

  const handleScoreChange = useCallback((roundNumber: number, court: number, score1: number, score2: number) => {
    setRounds(prev => prev.map(r => {
      if (r.roundNumber !== roundNumber) return r;
      return { ...r, assignments: r.assignments.map(a => a.court === court ? { ...a, score1, score2 } : a) };
    }));
  }, []);

  const handleScoreChangeSkill = useCallback((roundNumber: number, court: number, score1: number, score2: number) => {
    setSkillRounds(prev => prev.map(r => {
      if (r.roundNumber !== roundNumber) return r;
      return { ...r, assignments: r.assignments.map(a => a.court === court ? { ...a, score1, score2 } : a) };
    }));
  }, []);

  const currentRoundIndex = rounds.length - 1;

  return (
    <div className="px-4 pt-4 pb-4">
      <div className="rounded-2xl px-4 py-3 border mb-4" style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, transparent), rgba(255,255,255,0.03) 45%, color-mix(in srgb, var(--accent-2) 8%, transparent))',
        borderColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
        boxShadow: '0 8px 24px rgba(80,40,140,0.45), inset 0 1px 0 rgba(255,255,255,0.07)',
      }}>
        <div className="text-lg font-bold text-slate-100 mb-0.5">Match Scheduler</div>
        <div className="text-xs text-slate-500">{sessionName} &middot; {dateStr}</div>
      </div>

      {/* Day tabs */}
      <div className="flex gap-2 mb-4">
        {(['saturday', 'wednesday'] as Day[]).map(d => (
          <button key={d} onClick={() => {
            setActiveDay(d);
            if (rounds.length > 0) {
              setRounds([]); setGamesPlayed({}); setRestCount({}); setPartnerHistory({}); setOpponentHistory({}); setPlayerSnapshot([]); setForceSkillPhase(false);
            }
            if (skillRounds.length > 0) {
              setSkillRounds([]); setSkillGamesPlayed({}); setSkillRestCount({}); setSkillPartnerHistory({}); setSkillOpponentHistory({}); setSkillPlayerSnapshot([]);
            }
          }}
          className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all capitalize ${
            activeDay === d ? 'btn-gradient border-transparent text-white shadow-lg shadow-[var(--accent)]/20' : 'bg-white/[0.05] border-violet-400/20 text-slate-400 hover:border-violet-400/40'
          }`}>
            {d}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 neon-card">
          <div className="p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Users size={12} className="text-violet-400" />
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Players</span>
            </div>
            <div className="text-lg font-bold text-slate-100">{activePlayers.length}</div>
          </div>
        </div>
        <div className="flex-1 neon-card">
          <div className="p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <LayoutGrid size={12} className="text-lime-400" />
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Courts</span>
            </div>
            <div className="text-lg font-bold text-slate-100">
              {courts.join(', ')}
              <span className="text-xs text-slate-500 font-normal ml-1">({courtCapacity} cap)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Schedule Mode Tabs */}
      <div className="flex gap-1 mb-4 bg-white/[0.04] rounded-xl p-1 border border-violet-400/15">
        <button
          onClick={() => setScheduleMode('mix')}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
            scheduleMode === 'mix' ? 'btn-gradient' : 'text-slate-400 hover:text-slate-300'
          }`}
          style={scheduleMode === 'mix' ? { boxShadow: '0 0 12px color-mix(in srgb, var(--accent) 35%, transparent)' } : undefined}
        >
          🔀 Free Mix
        </button>
        <button
          onClick={() => setScheduleMode('skill')}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
            scheduleMode === 'skill' ? 'btn-gradient' : 'text-slate-400 hover:text-slate-300'
          }`}
          style={scheduleMode === 'skill' ? { boxShadow: '0 0 12px color-mix(in srgb, var(--accent) 35%, transparent)' } : undefined}
        >
          🏆 Skill Match
        </button>
      </div>

      {!enoughPlayers && (
        <div className="neon-card mb-4">
          <div className="p-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <span className="text-xs text-amber-400">At least 4 players are needed to schedule doubles matches.</span>
          </div>
        </div>
      )}

      {enoughPlayers && scheduleMode === 'mix' && rounds.length === 0 && needsSchedule && (
        <div className="neon-card mb-4">
          <div className="p-3">
            <div className="text-xs text-violet-300 mb-1">More players ({activePlayers.length}) than court capacity ({courtCapacity}).</div>
            <div className="text-xs text-violet-400 font-medium">Prepare a fair match schedule?</div>
          </div>
        </div>
      )}

      {enoughPlayers && (
        <div className="space-y-2 mb-4">
          {/* Rounds input and schedule generation — available to all logged-in users.
              Only Reset is admin-gated to prevent mid-session reshuffling. */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Rounds:</label>
            <input
              type="number" min={1} max={20} value={totalRoundsSetting}
              onChange={e => setTotalRoundsSetting(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-16 bg-white/[0.06] border border-violet-400/20 rounded-lg px-2 py-1.5 text-sm text-slate-200 text-center"
            />
          </div>

          {scheduleMode === 'mix' ? (
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleGenerateNextRound} className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors">
                <Play size={12} /> Next Round
              </button>
              <button onClick={handlePrepareFullSchedule} className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-2 rounded-xl bg-violet-800 hover:bg-violet-700 text-white transition-colors">
                <ListOrdered size={12} /> Full Schedule
              </button>
              {isAdmin && (
                <button onClick={handleReset} className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-2 rounded-xl bg-white/[0.05] text-slate-300 border border-violet-400/15 transition-colors">
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleGenerateSkillRound} className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-2 rounded-xl btn-gradient hover:brightness-110 text-white transition-colors">
                <Play size={12} /> Next Round
              </button>
              <button onClick={handlePrepareFullSkillSchedule} className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-2 rounded-xl bg-gradient-to-r from-[#c44ddb] to-[var(--accent)] hover:brightness-110 text-white transition-colors">
                <ListOrdered size={12} /> Full Schedule
              </button>
              {isAdmin && (
                <button onClick={handleResetSkill} className="flex items-center gap-1.5 text-[10px] font-semibold px-3 py-2 rounded-xl bg-white/[0.05] text-slate-300 border border-violet-400/15 transition-colors">
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Free Mix Rounds */}
      {scheduleMode === 'mix' && rounds.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">🔀 Free Mix · Round {rounds.length} of {totalRoundsSetting}</span>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <ExportMenu rounds={rounds} currentRoundIndex={currentRoundIndex} sessionName={sessionName} dateStr={dateStr} playerCount={activePlayers.length} courts={courts} gamesPlayed={gamesPlayed} />
              )}
              <DownloadPDF rounds={rounds} sessionName={`${sessionName} - Free Mix`} dateStr={dateStr} playerCount={activePlayers.length} courts={courts} gamesPlayed={gamesPlayed} />
            </div>
          </div>

          <div className="neon-card mb-3">
            <div className="p-3">
              <div className="text-[10px] text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Games Played</div>
              <div className="flex flex-wrap gap-1">
                {(playerSnapshot.length > 0 ? playerSnapshot : activePlayers).map(p => (
                  <span key={p} className="text-[10px] bg-violet-400/10 border border-violet-400/15 text-slate-300 px-1.5 py-0.5 rounded">
                    {p}: <span className="text-violet-400 font-semibold">{gamesPlayed[p] || 0}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {[...rounds].map(round => (
            <RoundCard
              key={round.roundNumber}
              round={round}
              isCurrentRound={round.roundNumber === rounds.length}
              isAdmin={isAdmin}
              onToggleLock={handleToggleLock}
              onSwapPlayers={handleSwapPlayers}
              onScoreChange={handleScoreChange}
              allPlayingPlayers={playerSnapshot.length > 0 ? playerSnapshot : activePlayers}
              gamesPlayed={gamesPlayed}
              skillMap={skillMap}
            />
          ))}

          <FairnessSummary gamesPlayed={gamesPlayed} restCount={restCount} partnerHistory={partnerHistory} opponentHistory={opponentHistory} players={playerSnapshot.length > 0 ? playerSnapshot : activePlayers} />
        </>
      )}

      {/* Skill Match Rounds */}
      {scheduleMode === 'skill' && skillRounds.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">🏆 Skill Match · Round {skillRounds.length} of {totalRoundsSetting}</span>
            <div className="flex items-center gap-2">
              <DownloadPDF rounds={skillRounds} sessionName={`${sessionName} - Skill Match`} dateStr={dateStr} playerCount={activePlayers.length} courts={courts} gamesPlayed={skillGamesPlayed} />
            </div>
          </div>

          <div className="neon-card mb-3">
            <div className="p-3">
              <div className="text-[10px] text-slate-500 font-medium mb-1.5 uppercase tracking-wide">Games Played</div>
              <div className="flex flex-wrap gap-1">
              {(skillPlayerSnapshot.length > 0 ? skillPlayerSnapshot : activePlayers.filter(p => !guestNames.includes(p))).map(p => (
                <span key={p} className="text-[10px] bg-violet-400/10 border border-violet-400/15 text-slate-300 px-1.5 py-0.5 rounded">
                  {p}: <span className="text-emerald-400 font-semibold">{skillGamesPlayed[p] || 0}</span>
                </span>
              ))}
              {guestNames.length > 0 && (
                <span className="text-[10px] text-purple-400/60 px-1.5 py-0.5">
                  Guests can be swapped in manually
                </span>
              )}
              </div>
            </div>
          </div>

          {[...skillRounds].map(round => (
            <RoundCard
              key={round.roundNumber}
              round={round}
              isCurrentRound={round.roundNumber === skillRounds.length}
              isAdmin={isAdmin}
              onToggleLock={(rn) => setSkillRounds(prev => prev.map(r => r.roundNumber === rn ? { ...r, locked: !r.locked } : r))}
              onSwapPlayers={handleSwapSkillPlayers}
              onScoreChange={handleScoreChangeSkill}
              allPlayingPlayers={activePlayers}
              extraSwapPlayers={guestNames}
              gamesPlayed={skillGamesPlayed}
              skillMap={skillMap}
            />
          ))}

          <FairnessSummary gamesPlayed={skillGamesPlayed} restCount={skillRestCount} partnerHistory={skillPartnerHistory} opponentHistory={skillOpponentHistory} players={skillPlayerSnapshot.length > 0 ? skillPlayerSnapshot : activePlayers} />
        </>
      )}

      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="neon-card max-w-sm w-full shadow-2xl shadow-black/60">
            <div className="p-5">
              <div className="text-sm font-semibold text-slate-100 mb-2">Reset Schedule?</div>
              <div className="text-xs text-slate-400 mb-4">This will clear all generated rounds and scheduling history. Continue?</div>
              <div className="flex gap-2">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-slate-700/60 bg-transparent text-slate-300">Cancel</button>
                <button onClick={confirmReset} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white">Reset</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPlayerChangePrompt && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="neon-card max-w-sm w-full shadow-2xl shadow-black/60">
            <div className="p-5">
              <div className="text-sm font-semibold text-slate-100 mb-2">Player List Changed</div>
              <div className="text-xs text-slate-400 mb-4">Player list has changed. Keep previous rounds and adjust future rounds, or reset and start fresh?</div>
              <div className="flex gap-2">
                <button onClick={() => handlePlayerChangeDecision('keep')} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-slate-700/60 bg-transparent text-slate-300">Keep & Adjust</button>
                <button onClick={() => handlePlayerChangeDecision('reset')} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white">Reset</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}