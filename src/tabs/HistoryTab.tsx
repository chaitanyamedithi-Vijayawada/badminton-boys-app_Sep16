import { useState, useMemo } from 'react';
import { CheckCircle, Zap, UserPlus, X, Users, Clock, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { makeInitials } from '../lib/constants';
import { supabase } from '../lib/supabase';
import type { Day, GuestLevel, GuestEntry } from '../types';
import LogPastSessionModal from '../components/history/LogPastSessionModal';

// ── Constants ─────────────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<GuestLevel, string> = { E: 'Experienced', I: 'Intermediate', B: 'Beginner' };
const LEVEL_COLORS: Record<GuestLevel, string> = {
  E: 'bg-emerald-900/50 text-emerald-400 border-emerald-700/40',
  I: 'bg-violet-900/50 text-violet-400 border-violet-700/40',
  B: 'bg-amber-900/50 text-amber-400 border-amber-700/40',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionGroup {
  type: 'regular';
  key: string;
  week: string;
  day: Day;
  date: string;
  sortDate: string;
  players: string[];
  guests: { name: string; brought_by?: string }[];
  courts: number[];
  totalCost: number;
  perPerson: number;
  totalPeople: number;
  sessionHours: number;
  ratePerCourt?: number;
  playerHours?: Record<string, number>;
  isDeducted: boolean;
  completedId?: string | number;
}

interface ExtraSessionGroup {
  type: 'extra';
  key: string;
  id: number;
  title: string;
  date: string;
  sortDate: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  courts: number[];
  totalCost: number;
  perPerson: number;
  totalPeople: number;
  players: string[];
  isDeducted: boolean;
  hours: number;
}

type UnifiedSession = SessionGroup | ExtraSessionGroup;

interface CompletedSessionLite {
  id?: string | number;
  week: string;
  day: Day;
  session_date?: string;
  players_count: number;
  per_person: number;
  total_cost: number;
  session_hours?: number;
  rate_per_court?: number;
  player_hours?: Record<string, number>;
  courts: number[];
  auto_deducted?: boolean;
  is_extra?: boolean;
  guests?: { name: string; brought_by?: string }[];
  players?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSessionDate(week: string, day: Day): string {
  if (week.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const satDate = new Date(week + 'T00:00:00');
    if (day === 'wednesday') satDate.setDate(satDate.getDate() - 3);
    return satDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const match = week.match(/^(\d{4})-W(\d+)$/);
  if (!match) return week;
  const year = parseInt(match[1], 10);
  const weekNum = parseInt(match[2], 10);
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
  const daysToMonday = (jan1Day === 0 ? -6 : 1) - jan1Day;
  const week1Monday = new Date(year, 0, 1 + daysToMonday);
  const targetMonday = new Date(week1Monday);
  targetMonday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
  const dayOffset = day === 'saturday' ? 5 : 1;
  const targetDate = new Date(targetMonday);
  targetDate.setDate(targetMonday.getDate() + dayOffset);
  return targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function groupAttendance(
  attendanceData: { id: string; week: string; day: Day; player_name: string; created_at: string }[],
  ratePerCourt: number,
  courtData: { saturday: number[]; wednesday: number[] },
  completedSessions: CompletedSessionLite[],
  totalSatGuests: number,
  totalTueGuests: number,
  currentWeek: string,
  satGuests: GuestEntry[],
  wedGuests: GuestEntry[]
): SessionGroup[] {
  const groups: Record<string, SessionGroup> = {};

  // Build groups from attendance records
  attendanceData.forEach(record => {
    const key = `${record.week}-${record.day}`;
    if (!groups[key]) {
      const courts = courtData[record.day] ?? [];
      const totalCost = courts.length * ratePerCourt;
      const completedRef = completedSessions.find(
        s => s.week === record.week && s.day === record.day && !s.is_extra
      );
      groups[key] = {
        type: 'regular',
        key,
        week: record.week,
        day: record.day,
        date: getSessionDate(record.week, record.day),
        sortDate: completedRef?.session_date ?? record.week,
        players: [],
        guests: [],
        courts,
        totalCost,
        perPerson: 0,
        totalPeople: 0,
        sessionHours: completedRef?.session_hours ?? 2,
        ratePerCourt: completedRef?.rate_per_court,
        playerHours: completedRef?.player_hours,
        isDeducted: completedRef ? !!completedRef.auto_deducted : false,
        completedId: completedRef?.id,
      };
    }
    if (!groups[key].players.includes(record.player_name)) {
      groups[key].players.push(record.player_name);
    }
  });

  // Add completed sessions that have no attendance records (e.g. older data)
  completedSessions.forEach(cs => {
    if (cs.is_extra) return; // skip extra sessions — handled separately
    const key = `${cs.week}-${cs.day}`;
    if (!groups[key] && cs.auto_deducted) {
      groups[key] = {
        type: 'regular',
        key,
        week: cs.week,
        day: cs.day,
        date: getSessionDate(cs.week, cs.day),
        sortDate: cs.session_date ?? cs.week,
        players: cs.players ?? [],
        guests: cs.guests ?? [],
        courts: cs.courts ?? [],
        totalCost: cs.total_cost,
        perPerson: cs.per_person,
        totalPeople: cs.players_count,
        sessionHours: cs.session_hours ?? 2,
        ratePerCourt: cs.rate_per_court,
        playerHours: cs.player_hours,
        isDeducted: true,
        completedId: cs.id,
      };
    }
  });

  // Enrich groups with completed session data
  Object.values(groups).forEach(g => {
    const completed = completedSessions.find(
      s => s.week === g.week && s.day === g.day && !s.is_extra
    );
    if (completed && completed.players_count > 0) {
      g.totalCost = completed.total_cost;
      g.courts = completed.courts;
      g.guests = completed.guests || [];
      g.completedId = completed.id;
      g.sessionHours = completed.session_hours ?? 2;
      if (completed.players && completed.players.length > 0) g.players = completed.players;
      const actualCount = g.players.length + g.guests.length;
      g.totalPeople = actualCount;
      g.perPerson = completed.per_person || (actualCount > 0 ? g.totalCost / actualCount : 0);
    } else {
      const isCurrentWeek = g.week === currentWeek;
      const guestList = isCurrentWeek ? (g.day === 'saturday' ? satGuests : wedGuests) : [];
      g.guests = guestList;
      const guestsCount = isCurrentWeek ? (g.day === 'saturday' ? totalSatGuests : totalTueGuests) : 0;
      const totalPeople = g.players.length + guestsCount;
      g.totalPeople = totalPeople;
      g.perPerson = totalPeople > 0 ? g.totalCost / totalPeople : 0;
    }
  });

  return Object.values(groups).sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function HistoryTab() {
  const {
    attendanceData, players, ratePerCourt, courtData,
    completedSessions, guestData, currentUser, myName,
    loadAttendance, loadPlayers, loadCompletedSessions, verifyAdminPin, showToast,
    extraSessions, extraSessionRsvps, loadExtraSessions, handleUpdateSessionPlayerHours, handleUpdateSessionCourts,
  } = useApp();

  const isAdmin = currentUser?.role === 'admin';

  // Admin-only "Log past session" modal (retro-log a missed Sat/Tue session)
  const [showLogPast, setShowLogPast] = useState(false);

  // ── Player-hours adjustment state ────────────────────────────────────────────
  const [adjustingHoursFor, setAdjustingHoursFor] = useState<string | null>(null);
  const [editingCourtsFor, setEditingCourtsFor] = useState<string | null>(null);
  const [pendingCourts, setPendingCourts] = useState<number>(1);
  const [applyingCourts, setApplyingCourts] = useState(false);
  const [pendingHours, setPendingHours] = useState<Record<string, number>>({});
  const [applyingHours, setApplyingHours] = useState(false);

  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingPlayer, setRemovingPlayer] = useState<string | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [guestForPlayer, setGuestForPlayer] = useState<string>('');
  const [guestName, setGuestName] = useState('');
  const [guestLevel, setGuestLevel] = useState<GuestLevel>('I');

  const currentWeek = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilSat = (6 - day + 7) % 7;
    const thisSat = new Date(now);
    thisSat.setDate(now.getDate() + daysUntilSat);
    const yyyy = thisSat.getFullYear();
    const mm = String(thisSat.getMonth() + 1).padStart(2, '0');
    const dd = String(thisSat.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const totalSatGuests = guestData.saturday.length;
  const totalTueGuests = guestData.wednesday.length;

  // ── Regular sessions ────────────────────────────────────────────────────────
  const regularSessions = useMemo(() => {
    const combined = groupAttendance(
      attendanceData, ratePerCourt, courtData,
      completedSessions, totalSatGuests, totalTueGuests, currentWeek,
      guestData.saturday, guestData.wednesday
    );
    // Only show sessions that have actually been completed (i.e. have a matching
    // completed_sessions row, so completedId is set). This is clock-independent:
    // upcoming sessions only have RSVP/attendance rows and no completed row, so
    // they never leak into History regardless of timezone or device clock.
    return combined.filter(s => s.completedId != null);
  }, [attendanceData, ratePerCourt, courtData, completedSessions,
      totalSatGuests, totalTueGuests, currentWeek, guestData]);

  // ── Completed extra sessions ─────────────────────────────────────────────────
  const completedExtraSessions = useMemo((): ExtraSessionGroup[] => {
    return extraSessions.filter(s => {
      if (s.cancelled) return false;
      if ((s.players_count ?? 0) === 0) return false;
      const [hours, minutes] = s.end_time.split(':').map(Number);
      const [year, month, day] = s.session_date.split('-').map(Number);
      const end = new Date(year, month - 1, day, hours, minutes, 0, 0);
      return new Date() > end;
    })
      .map(s => {
        const rsvps = extraSessionRsvps.filter(r => r.session_id === s.id && r.status === 'going');
        const goingPlayers = rsvps.map(r => r.player_name);
        const totalPeople = s.players_count ?? goingPlayers.length;
        const totalCost = s.total_cost ?? (s.courts.length * ratePerCourt);
        const perPerson = s.per_person ?? (totalPeople > 0 ? totalCost / totalPeople : 0);
        const dateStr = new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        });
        const [startH, startM] = s.start_time.split(':').map(Number);
        const [endH, endM] = s.end_time.split(':').map(Number);
        const sessionHours = ((endH * 60 + endM) - (startH * 60 + startM)) / 60;
        return {
          type: 'extra' as const,
          key: `extra-${s.id}`,
          id: s.id,
          title: s.title,
          date: dateStr,
          sortDate: s.session_date,
          sessionDate: s.session_date,
          startTime: s.start_time,
          endTime: s.end_time,
          courts: s.courts,
          totalCost,
          perPerson,
          totalPeople,
          players: goingPlayers,
          isDeducted: !!s.auto_deducted,
          hours: sessionHours,
        };
      });
  }, [extraSessions, extraSessionRsvps, ratePerCourt]);

  // ── Unified sorted list ──────────────────────────────────────────────────────
  const allSessions = useMemo((): UnifiedSession[] => {
    return [...regularSessions, ...completedExtraSessions]
      .sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  }, [regularSessions, completedExtraSessions]);

  const months = useMemo(() => {
    const set = new Set<string>();
    allSessions.forEach(s => {
      const d = new Date(s.date);
      if (!isNaN(d.getTime())) {
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    });
    return Array.from(set).sort().reverse();
  }, [allSessions]);

  const filtered = useMemo(() => {
    return allSessions.filter(s => {
      if (selectedPlayer) {
        const inPlayers = s.players.includes(selectedPlayer);
        // ✅ also match if they brought a guest (regular sessions only)
        const broughtGuest =
          s.type === 'regular' &&
          s.guests.some(g => g.brought_by === selectedPlayer);
        if (!inPlayers && !broughtGuest) return false;
      }
     
      if (selectedMonth) {
        const d = new Date(s.date);
        if (isNaN(d.getTime())) return true;
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (month !== selectedMonth) return false;
      }
      return true;
    });
  }, [allSessions, selectedPlayer, selectedMonth]);

  const playerStats = useMemo(() => {
    if (!selectedPlayer) return null;
    const playerSessions = allSessions.filter(s => {
      const inPlayers = s.players.includes(selectedPlayer);
      const broughtGuest =
        s.type === 'regular' &&
        s.guests.some(g => g.brought_by === selectedPlayer);
      return inPlayers || broughtGuest;
    });
    const totalPaid = playerSessions.reduce((sum, s) => {
      if (s.type === 'regular' && !s.players.includes(selectedPlayer)) {
        // Only brought guests — count guest slots, not player slot
        const guestCount = s.guests.filter(g => g.brought_by === selectedPlayer).length;
        return sum + s.perPerson * guestCount;
      }
      const guestCount =
        s.type === 'regular'
          ? s.guests.filter(g => g.brought_by === selectedPlayer).length
          : 0;
      return sum + s.perPerson * (1 + guestCount);
    }, 0);
    return { sessionsCount: playerSessions.length, totalPaid };
  }, [allSessions, selectedPlayer]);

  const playerInfo = players.find(p => p.name === selectedPlayer);

  // ── Shared helpers ───────────────────────────────────────────────────────────

  const buildAdjustmentTxns = async (
    playerNames: string[],
    guests: { name: string; brought_by?: string }[],
    amountPerSlot: number,
    sessionId: string,
    note: string
  ) => {
    if (Math.abs(amountPerSlot) < 0.005) return;
    const slotCount: Record<string, number> = {};
    playerNames.forEach(name => { slotCount[name] = 1; });
    guests.forEach(g => {
      if (g.brought_by && slotCount[g.brought_by] !== undefined) slotCount[g.brought_by] += 1;
    });
    const names = Object.keys(slotCount);
    if (names.length === 0) return;
    const { data: playerRows } = await supabase.from('players').select('id, name').in('name', names);
    if (!playerRows?.length) return;
    await supabase.from('transactions').insert(
      playerRows.map(p => ({
        player_id: p.id,
        type: 'adjustment',
        amount: Number((amountPerSlot * slotCount[p.name]).toFixed(2)),
        session_id: sessionId,
        note,
      }))
    );
  };

  // ── Regular session handlers ─────────────────────────────────────────────────

  const handleStartAdd = (key: string) => {
    if (!verifyAdminPin()) return;
    setAddingTo(addingTo === key ? null : key);
    setGuestMode(false);
    setGuestForPlayer('');
  };

  const handleAddPlayer = async (session: SessionGroup, playerName: string) => {
    if (adding) return;
    setAdding(true);
    try {
      const targetPlayer = players.find(p => p.name === playerName);
      if (!targetPlayer) throw new Error('Player profile not found');
      const completedSession = completedSessions.find(
        s => s.week === session.week && s.day === session.day
      ) as CompletedSessionLite | undefined;
      if (!completedSession) throw new Error('Completed session record not found');
      const oldPerPerson = Number(completedSession.per_person);
      const existingPlayers = completedSession.players ?? session.players;
      const existingGuests = completedSession.guests ?? [];
      const updatedPlayers = [...existingPlayers];
      if (!updatedPlayers.includes(playerName)) updatedPlayers.push(playerName);
      const newCount = updatedPlayers.length + existingGuests.length;
      const newPerPerson = newCount > 0 ? Number(completedSession.total_cost) / newCount : 0;
      const diff = oldPerPerson - newPerPerson;
      await supabase.from('rsvps').upsert(
        { week: session.week, day: session.day, player_name: playerName, status: 'going' },
        { onConflict: 'week,day,player_name' }
      );
      await supabase.from('completed_sessions').update({
        players: updatedPlayers, players_count: newCount, per_person: newPerPerson,
      }).eq('id', completedSession.id);
      await buildAdjustmentTxns(
        existingPlayers, existingGuests, diff, String(completedSession.id),
        `Charge Adjustment — Player added to Match ${session.date} · $${newPerPerson.toFixed(2)}/person`
      );
      await supabase.from('transactions').insert({
        player_id: targetPlayer.id, type: 'match_charge', amount: -newPerPerson,
        session_id: String(completedSession.id),
        note: `Late Addition — Match ${session.date} · ${newCount} players · $${newPerPerson.toFixed(2)}/person`,
      });
      await loadAttendance(); await loadPlayers(); await loadCompletedSessions();
      showToast(`${playerName} added ✓`); setAddingTo(null);
    } catch (e: unknown) { showToast(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setAdding(false);
  };

  const handleRemovePlayer = async (session: SessionGroup, playerName: string) => {
    if (adding) return;
    if (!verifyAdminPin()) return;
    if (!window.confirm(`Remove ${playerName} from this session and reverse their charge?`)) return;
    setAdding(true); setRemovingPlayer(playerName);
    try {
      const targetPlayer = players.find(p => p.name === playerName);
      if (!targetPlayer) throw new Error('Player profile not found');
      const completedSession = completedSessions.find(
        s => s.week === session.week && s.day === session.day
      ) as CompletedSessionLite | undefined;
      if (!completedSession) throw new Error('Completed session record not found');
      const oldPerPerson = Number(completedSession.per_person);
      const existingGuests = completedSession.guests ?? [];
      const updatedPlayers = (completedSession.players ?? session.players).filter((p: string) => p !== playerName);
      const newCount = updatedPlayers.length + existingGuests.length;
      const newPerPerson = newCount > 0 ? Number(completedSession.total_cost) / newCount : 0;
      const diff = oldPerPerson - newPerPerson;
      await supabase.from('rsvps').delete()
        .eq('week', session.week).eq('day', session.day).eq('player_name', playerName);
      await supabase.from('completed_sessions').update({
        players: updatedPlayers, players_count: newCount, per_person: newPerPerson,
      }).eq('id', completedSession.id);
      await supabase.from('transactions').insert({
        player_id: targetPlayer.id, type: 'top_up', amount: oldPerPerson,
        note: `Reversal Credit — Removed from Match ${session.date}`,
      });
      await buildAdjustmentTxns(
        updatedPlayers, existingGuests, diff, String(completedSession.id),
        `Charge Adjustment — Player removed from Match ${session.date} · $${newPerPerson.toFixed(2)}/person`
      );
      await loadAttendance(); await loadPlayers(); await loadCompletedSessions();
      showToast(`${playerName} removed ✓`); setAddingTo(null);
    } catch (e: unknown) { showToast(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setAdding(false); setRemovingPlayer(null);
  };

  const handleAddGuest = async (session: SessionGroup) => {
    if (adding || !guestForPlayer) return;
    setAdding(true);
    try {
      const name = guestName.trim() || `${guestForPlayer}'s guest`;
      const hostPlayer = players.find(p => p.name === guestForPlayer);
      if (!hostPlayer) throw new Error('Host player profile not found');
      const completedSession = completedSessions.find(
        s => s.week === session.week && s.day === session.day
      ) as CompletedSessionLite | undefined;
      if (!completedSession) throw new Error('Completed session record not found');
      const oldPerPerson = Number(completedSession.per_person);
      const existingPlayers = completedSession.players ?? session.players;
      const existingGuests = completedSession.guests ?? [];
      const updatedGuests = [...existingGuests, { name, brought_by: guestForPlayer }];
      const newCount = existingPlayers.length + updatedGuests.length;
      const newPerPerson = newCount > 0 ? Number(completedSession.total_cost) / newCount : 0;
      const diff = oldPerPerson - newPerPerson;
      await supabase.from('completed_sessions').update({
        guests: updatedGuests, players_count: newCount, per_person: newPerPerson,
      }).eq('id', completedSession.id);
      await buildAdjustmentTxns(
        existingPlayers, existingGuests, diff, String(completedSession.id),
        `Charge Adjustment — Guest added to Match ${session.date} · $${newPerPerson.toFixed(2)}/person`
      );
      await supabase.from('transactions').insert({
        player_id: hostPlayer.id, type: 'match_charge', amount: -newPerPerson,
        session_id: String(completedSession.id),
        note: `Guest Charge — ${name} hosted by ${guestForPlayer} · Match ${session.date} · $${newPerPerson.toFixed(2)}/person`,
      });
      await loadAttendance(); await loadPlayers(); await loadCompletedSessions();
      showToast(`Guest added ✓`);
      setGuestMode(false); setGuestForPlayer(''); setGuestName(''); setAddingTo(null);
    } catch (e: unknown) { showToast(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setAdding(false);
  };

  const handleRemoveGuest = async (session: SessionGroup, guestIndex: number) => {
    if (adding) return;
    if (!verifyAdminPin()) return;
    const guest = session.guests[guestIndex];
    if (!window.confirm(`Remove guest ${guest.name || 'Guest'} and refund ${guest.brought_by}?`)) return;
    setAdding(true);
    try {
      const hostPlayer = players.find(p => p.name === guest.brought_by);
      if (!hostPlayer) throw new Error('Host profile missing');
      const completedSession = completedSessions.find(
        s => s.week === session.week && s.day === session.day
      ) as CompletedSessionLite | undefined;
      if (!completedSession) throw new Error('Completed session record not found');
      const oldPerPerson = Number(completedSession.per_person);
      const existingPlayers = completedSession.players ?? session.players;
      const updatedGuests = session.guests.filter((_, i) => i !== guestIndex);
      const newCount = existingPlayers.length + updatedGuests.length;
      const newPerPerson = newCount > 0 ? Number(completedSession.total_cost) / newCount : 0;
      const diff = oldPerPerson - newPerPerson;
      await supabase.from('completed_sessions').update({
        guests: updatedGuests, players_count: newCount, per_person: newPerPerson,
      }).eq('id', completedSession.id);
      await supabase.from('transactions').insert({
        player_id: hostPlayer.id, type: 'top_up', amount: oldPerPerson,
        note: `Guest Reversal — Removed ${guest.name || 'Guest'} from Match ${session.date}`,
      });
      await buildAdjustmentTxns(
        existingPlayers, updatedGuests, diff, String(completedSession.id),
        `Charge Adjustment — Guest removed from Match ${session.date} · $${newPerPerson.toFixed(2)}/person`
      );
      await loadAttendance(); await loadPlayers(); await loadCompletedSessions();
      showToast(`Guest removed ✓`); setAddingTo(null);
    } catch (e: unknown) { showToast(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setAdding(false);
  };

  // ── Extra session handlers ───────────────────────────────────────────────────

  const handleExtraAddPlayer = async (session: ExtraSessionGroup, playerName: string) => {
    if (adding) return;
    setAdding(true);
    try {
      const targetPlayer = players.find(p => p.name === playerName);
      if (!targetPlayer) throw new Error('Player profile not found');
      const oldPerPerson = session.perPerson;
      const newCount = session.totalPeople + 1;
      const newPerPerson = newCount > 0 ? session.totalCost / newCount : 0;
      const diff = oldPerPerson - newPerPerson;
      await supabase.from('extra_sessions').update({
        players_count: newCount, per_person: newPerPerson,
      }).eq('id', session.id);
      await supabase.from('extra_session_rsvps').upsert(
        { session_id: session.id, player_name: playerName, status: 'going' },
        { onConflict: 'session_id,player_name' }
      );
      // Keep the completed_sessions row in sync so emails reflect the updated
      // player list and per-person cost.
      const extraWeekKey = `extra-${session.id}-${session.sessionDate}`;
      const updatedPlayers = [...session.players, playerName];
      await supabase.from('completed_sessions').update({
        players: updatedPlayers, players_count: newCount, per_person: newPerPerson,
      }).eq('week', extraWeekKey);
      if (Math.abs(diff) >= 0.005 && session.players.length > 0) {
        const { data: existingRows } = await supabase
          .from('players').select('id, name').in('name', session.players);
        if (existingRows?.length) {
          await supabase.from('transactions').insert(
            existingRows.map((p: { id: string; name: string }) => ({
              player_id: p.id, type: 'adjustment', amount: Number(diff.toFixed(2)),
              note: `Charge Adjustment — Player added to Extra Session ${session.title} · $${newPerPerson.toFixed(2)}/person`,
            }))
          );
        }
      }
      await supabase.from('transactions').insert({
        player_id: targetPlayer.id, type: 'match_charge', amount: -newPerPerson,
        note: `Late Addition — Extra Session ${session.title} · ${session.date} · $${newPerPerson.toFixed(2)}/person`,
      });
      await loadExtraSessions(); await loadPlayers();
      showToast(`${playerName} added ✓`); setAddingTo(null);
    } catch (e: unknown) { showToast(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setAdding(false);
  };

  const handleExtraRemovePlayer = async (session: ExtraSessionGroup, playerName: string) => {
    if (adding) return;
    if (!verifyAdminPin()) return;
    if (!window.confirm(`Remove ${playerName} from ${session.title} and reverse their charge?`)) return;
    setAdding(true); setRemovingPlayer(playerName);
    try {
      const targetPlayer = players.find(p => p.name === playerName);
      if (!targetPlayer) throw new Error('Player profile not found');

      // Look up the completed_sessions row for this extra session
      const { data: csRow } = await supabase
        .from('completed_sessions')
        .select('id')
        .eq('session_date', session.sessionDate)
        .eq('is_extra', true)
        .maybeSingle();

      // Look up the player's actual charge for this session — don't use
      // the potentially-stale per_person from extra_sessions.
      const { data: existingTxn } = csRow ? await supabase
        .from('transactions')
        .select('id, amount')
        .eq('session_id', String(csRow.id))
        .eq('player_id', targetPlayer.id)
        .eq('type', 'match_charge')
        .maybeSingle() : { data: null };

      const actualCharge = existingTxn ? Math.abs(Number(existingTxn.amount)) : 0;

      const newCount = Math.max(0, session.totalPeople - 1);
      const newPerPerson = newCount > 0 ? session.totalCost / newCount : 0;
      const diff = (session.perPerson ?? 0) - newPerPerson;

      await supabase.from('extra_sessions').update({
        players_count: newCount, per_person: newPerPerson,
      }).eq('id', session.id);

      await supabase.from('extra_session_rsvps').delete()
        .eq('session_id', session.id).eq('player_name', playerName);

      // Keep the completed_sessions row in sync so emails reflect the updated
      // player list and per-person cost.
      const extraWeekKey = `extra-${session.id}-${session.sessionDate}`;
      const remainingPlayers = session.players.filter(n => n !== playerName);
      await supabase.from('completed_sessions').update({
        players: remainingPlayers, players_count: newCount, per_person: newPerPerson,
      }).eq('week', extraWeekKey);

      // Only issue a reversal if the player was actually charged
      if (actualCharge > 0) {
        // Delete the original charge instead of adding a top_up
        if (existingTxn) {
          await supabase.from('transactions').delete().eq('id', existingTxn.id);
        }
      }

      const remainingNames = session.players.filter(n => n !== playerName);
      if (Math.abs(diff) >= 0.005 && remainingNames.length > 0) {
        const { data: remainingRows } = await supabase
          .from('players').select('id, name').in('name', remainingNames);
        if (remainingRows?.length) {
          await supabase.from('transactions').insert(
            remainingRows.map((p: { id: string; name: string }) => ({
              player_id: p.id, type: 'adjustment', amount: Number(diff.toFixed(2)),
              note: `Charge Adjustment — Player removed from Extra Session ${session.title} · $${newPerPerson.toFixed(2)}/person`,
            }))
          );
        }
      }
      await loadExtraSessions(); await loadPlayers();
      showToast(`${playerName} removed ✓`); setAddingTo(null);
    } catch (e: unknown) { showToast(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setAdding(false); setRemovingPlayer(null);
  };

  // ── Render: extra session card ───────────────────────────────────────────────

  const renderExtraCard = (session: ExtraSessionGroup) => {
    const isAddingHere = addingTo === session.key;
    const myPlayer = players.find(p => p.name === myName);
    const wasGoing = session.players.includes(myName ?? '');
    const totalDeducted = session.perPerson;
    const newBal = myPlayer?.balance ?? 0;
    const oldBal = wasGoing ? newBal + totalDeducted : null;

    return (
      <div key={session.key} className="neon-card border-purple-700/30">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm font-semibold text-slate-100">{session.title}</div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400 border border-purple-700/30">
                Extra
              </span>
              {session.isDeducted && (
                <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/30 px-2 py-0.5 rounded-full">
                  <Zap size={10} /> Fees Deducted
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">{session.date}</div>
            <div className="text-xs text-slate-500">{session.startTime} – {session.endTime}</div>
          </div>
          <div className="text-right">
            <div className="text-base font-bold text-purple-400">${session.totalCost.toFixed(2)}</div>
            <div className="text-xs text-slate-400">
              {session.totalPeople > 0 ? `${session.totalPeople} people` : 'total'}
            </div>
            {session.perPerson > 0 && (
              <div className="text-xs text-emerald-400">${session.perPerson.toFixed(2)}/person</div>
            )}
          </div>
        </div>


        {/* Courts */}
        <div className="flex gap-1 mb-2 flex-wrap items-center">
          {session.courts.map(c => (
            <span key={c} className="bg-purple-900/30 text-purple-400 text-xs px-2 py-0.5 rounded-full border border-purple-700/30">
              Court {c}
            </span>
          ))}
          {session.isDeducted && (
            <span className="text-xs font-semibold ml-1 px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400 border border-purple-700/30">
              ⏱ {session.courts.length * session.hours} hrs
            </span>
          )}
      </div>

        {/* Fees deducted card */}
        {session.isDeducted && (
          <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-4 py-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={13} className="text-emerald-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-emerald-400">Session completed — fees deducted</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <span>{session.totalPeople} players</span>
              <span className="text-slate-600">·</span>
              <span>{session.courts.length} court{session.courts.length !== 1 ? 's' : ''}</span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400 font-medium">${session.perPerson.toFixed(2)}/person</span>
            </div>
            {myName && wasGoing && oldBal !== null && myPlayer && (
              <div className="mt-2 pt-2 border-t border-emerald-900/40">
                <div className="text-xs text-slate-500 mb-1.5">Your balance change</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-300">${oldBal.toFixed(2)}</span>
                  <span className="text-xs text-slate-600">→</span>
                  <span className="text-xs text-red-400 font-medium">−${totalDeducted.toFixed(2)}</span>
                  <span className="text-xs text-slate-600">→</span>
                  <span className={`text-sm font-bold ${newBal < 0 ? 'text-red-400' : newBal < 15 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    ${newBal.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            {myName && !wasGoing && (
              <div className="text-xs text-slate-600 mt-1">You were not in this session</div>
            )}
          </div>
        )}

        {/* Players */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {session.players
            .filter(name => !selectedPlayer || name === selectedPlayer)
            .map(name => {
            const p = players.find(pl => pl.name === name);
            return (
              <div key={name} className="flex items-center gap-1.5 bg-violet-400/10 border border-violet-400/15 rounded-full px-2 py-1">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold"
                  style={{ background: p?.color?.bg ?? 'rgba(100,100,100,0.2)', color: p?.color?.fg ?? '#aaa' }}
                >{makeInitials(name)}</div>
                <span className="text-xs text-slate-300 uppercase">{name}</span>
                {isAdmin && isAddingHere && (
                  <button
                    onClick={() => handleExtraRemovePlayer(session, name)}
                    disabled={adding && removingPlayer === name}
                    className="w-4 h-4 rounded-full bg-red-900/40 hover:bg-red-900/70 text-red-400/60 hover:text-red-400 flex items-center justify-center transition-colors"
                  ><X size={9} /></button>
                )}
              </div>
            );
          })}
        </div>

        {/* Admin controls */}
        {isAdmin && session.isDeducted && (
          <div className="border-t border-slate-800/60 pt-2">
            <button
              onClick={() => {
                if (!verifyAdminPin()) return;
                setAddingTo(isAddingHere ? null : session.key);
              }}
              className={`flex items-center gap-1.5 text-xs transition-colors ${
                isAddingHere ? 'text-violet-400' : 'text-slate-400 hover:text-violet-400'
              }`}
            >
              {isAddingHere ? <><X size={12} /> Cancel</> : <><UserPlus size={12} /> Add / Remove player</>}
            </button>
            {isAddingHere && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {players.filter(p => !session.players.includes(p.name)).length === 0 ? (
                  <div className="text-xs text-slate-500">All members already logged</div>
                ) : (
                  players.filter(p => !session.players.includes(p.name)).map(p => (
                    <button
                      key={p.name}
                      onClick={() => handleExtraAddPlayer(session, p.name)}
                      disabled={adding}
                      className="flex items-center gap-1.5 bg-violet-900/30 hover:bg-violet-900/50 border border-violet-700/30 rounded-full px-2 py-1 transition-colors"
                    >
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold"
                        style={{ background: p.color?.bg ?? '#334155', color: p.color?.fg ?? '#fff' }}
                      >{p.initials}</div>
                      <span className="text-xs text-violet-300 uppercase">{p.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Render: regular session card ─────────────────────────────────────────────

  const renderRegularCard = (session: SessionGroup) => {
    const key = session.key;
    const missingPlayers = players.filter(p => !session.players.includes(p.name));
    const isAddingHere = addingTo === key;

    return (
      <div key={key} className={`neon-card ${session.day === 'saturday' ? 'card-cyan' : 'card-lime'}`}>
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
          <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-slate-100 capitalize">{session.day}</div>
              {session.isDeducted ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/30 px-2 py-0.5 rounded-full">
                  <Zap size={10} /> Live Log Balanced
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-400 bg-red-900/30 border border-red-700/30 px-2 py-0.5 rounded-full">
                  ❌ Cancelled
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">{session.date}</div>
          </div>
          <div className="text-right">
            {session.isDeducted ? (
              <>
                <div className="text-base font-bold text-violet-400">${session.totalCost.toFixed(2)}</div>
                <div className="text-xs text-slate-400">
                  {session.totalPeople > 0 ? `${session.totalPeople} people` : 'total'}
                </div>
                {session.perPerson > 0 && (
                  <div className="text-xs text-emerald-400">${session.perPerson.toFixed(2)}/person</div>
                )}
              </>
            ) : (
              <div className="text-xs text-red-400/60">No charge</div>
            )}
          </div>
        </div>

        {/* Courts */}
        <div className="flex gap-1 mb-2 flex-wrap items-center">
          {session.courts.map(c => (
            <span key={c} className="bg-violet-900/30 text-violet-400 text-xs px-2 py-0.5 rounded-full border border-violet-700/30">
              Court {c}
            </span>
          ))}
          {session.isDeducted && (
            <span className="text-xs font-semibold ml-1 px-2 py-0.5 rounded-full bg-violet-900/30 text-violet-400 border border-violet-700/30">
              ⏱ {session.courts.length * session.sessionHours} hrs
            </span>
          )}
          {isAdmin && session.isDeducted && editingCourtsFor !== session.key && (
            <button
              onClick={() => { setEditingCourtsFor(session.key); setPendingCourts(session.courts.length); }}
              className="text-xs ml-1 px-2 py-0.5 rounded-full border border-amber-500/30 text-amber-400 bg-amber-900/20 hover:bg-amber-900/40 transition-colors"
            >
              ✎ Fix courts
            </button>
          )}
        </div>

        {/* Inline court-count editor (admin) */}
        {isAdmin && session.isDeducted && editingCourtsFor === session.key && (() => {
          const rate = session.ratePerCourt ?? ratePerCourt;
          const newTotal = pendingCourts * (rate / 2) * session.sessionHours;
          const changed = pendingCourts !== session.courts.length;
          return (
            <div className="bg-white/[0.04] border border-amber-400/20 rounded-xl p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-amber-300">Correct court count</span>
                <button onClick={() => setEditingCourtsFor(null)} className="text-xs text-slate-500">Cancel</button>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">
                Booked {session.courts.length} court{session.courts.length !== 1 ? 's' : ''}, but used fewer? Set the real number — charges recalculate for everyone.
              </p>
              <div className="flex gap-1.5 mb-3">
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <button
                    key={n}
                    onClick={() => setPendingCourts(n)}
                    className={`w-9 h-9 rounded-lg text-sm font-semibold border transition-all ${
                      pendingCourts === n ? '' : 'bg-slate-900/60 border-slate-700/60 text-slate-400'
                    }`}
                    style={pendingCourts === n ? {
                      background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-text)',
                    } : undefined}
                  >{n}</button>
                ))}
              </div>
              {changed && (
                <div className="text-xs text-slate-400 mb-2">
                  New total: <span className="text-emerald-400 font-medium">${newTotal.toFixed(2)}</span>
                  <span className="text-slate-600"> (was ${session.totalCost.toFixed(2)})</span>
                </div>
              )}
              <button
                disabled={!changed || applyingCourts}
                onClick={async () => {
                  setApplyingCourts(true);
                  await handleUpdateSessionCourts(session.completedId!, pendingCourts, {
                    players: session.players,
                    guests: session.guests as { name: string; brought_by?: string }[],
                    sessionHours: session.sessionHours,
                    ratePerCourt: rate,
                    playerHours: session.playerHours,
                    currentCourts: session.courts,
                    sortDate: session.sortDate,
                    day: session.day,
                  });
                  setEditingCourtsFor(null); setApplyingCourts(false);
                }}
                className="w-full py-2 rounded-xl btn-gradient hover:brightness-110 disabled:opacity-40 text-white text-xs font-semibold"
              >
                {applyingCourts ? 'Applying...' : 'Apply & recalculate charges'}
              </button>
            </div>
          );
        })()}

        {/* Session-completed banner with balance change — mirrors the extra
            session card so regular sessions get the same at-a-glance ledger. */}
        {session.isDeducted && (() => {
          const myPlayer = players.find(p => p.name === myName);
          const wasGoing = session.players.includes(myName ?? '');
          const myGuestCount = session.guests?.filter(g => g.brought_by === myName).length ?? 0;
          const perPerson = session.perPerson;
          const totalDeducted = perPerson * (1 + myGuestCount);
          const newBal = myPlayer?.balance ?? 0;
          const oldBal = wasGoing && perPerson > 0 ? newBal + totalDeducted : null;
          return (
            <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-4 py-3 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle size={13} className="text-emerald-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-emerald-400">Session completed — fees deducted</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                <span>{session.totalPeople} players</span>
                <span className="text-slate-600">·</span>
                <span>
                  {session.courts.length} court{session.courts.length !== 1 ? 's' : ''}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-400 font-medium">${session.perPerson.toFixed(2)}/person</span>
              </div>
              {myName && wasGoing && oldBal !== null && myPlayer && (
                <div className="mt-2 pt-2 border-t border-emerald-900/40">
                  <div className="text-xs text-slate-500 mb-1.5">
                    Your balance change
                    {myGuestCount > 0 && (
                      <span className="text-[10px] text-slate-500 ml-1">
                        (incl. {myGuestCount} guest{myGuestCount > 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-300">${oldBal.toFixed(2)}</span>
                    <span className="text-xs text-slate-600">→</span>
                    <span className="text-xs text-red-400 font-medium">−${totalDeducted.toFixed(2)}</span>
                    <span className="text-xs text-slate-600">→</span>
                    <span className={`text-sm font-bold ${newBal < 0 ? 'text-red-400' : newBal < 15 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      ${newBal.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              {myName && !wasGoing && (
                <div className="text-xs text-slate-600 mt-1">You were not in this session</div>
              )}
            </div>
          );
        })()}

        {/* Players + guests */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {session.players
            .filter(name => !selectedPlayer || name === selectedPlayer)
            .map(name => {
            const p = players.find(pl => pl.name === name);
            return (
              <div key={name} className="flex items-center gap-1.5 bg-violet-400/10 border border-violet-400/15 rounded-full px-2 py-1" title={name}>
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold"
                  style={{ background: p?.color?.bg ?? 'rgba(100,100,100,0.2)', color: p?.color?.fg ?? '#aaa' }}
                >{makeInitials(name)}</div>
                <span className="text-xs text-slate-300 uppercase">{name}</span>
                {isAdmin && isAddingHere && (
                  <button
                    onClick={() => handleRemovePlayer(session, name)}
                    disabled={adding && removingPlayer === name}
                    className="w-4 h-4 rounded-full bg-red-900/40 hover:bg-red-900/70 text-red-400/60 hover:text-red-400 flex items-center justify-center transition-colors"
                  ><X size={9} /></button>
                )}
              </div>
            );
          })}
          {session.guests
            .filter(g => !selectedPlayer || g.brought_by === selectedPlayer)
            .map((g, i) => (
            <div
              key={`guest-${i}`}
              className="flex items-center gap-1.5 bg-amber-900/20 rounded-full px-2 py-1 border border-amber-700/30"
            >
              <div className="w-5 h-5 rounded-full bg-amber-900/50 flex items-center justify-center text-xs font-semibold text-amber-400">G</div>
              <span className="text-xs text-amber-300 uppercase">{g.name || 'Guest'}</span>
              <span className="text-xs text-amber-500/60">· {g.brought_by}</span>
              {isAdmin && isAddingHere && (
                <button
                  onClick={() => handleRemoveGuest(session, i)}
                  disabled={adding}
                  className="w-4 h-4 rounded-full bg-red-900/40 hover:bg-red-900/70 text-red-400/60 hover:text-red-400 flex items-center justify-center transition-colors"
                ><X size={9} /></button>
              )}
            </div>
          ))}
        </div>

        {/* Admin controls */}
        {isAdmin && (
          <div className="border-t border-slate-800/60 pt-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { handleStartAdd(key); setGuestMode(false); }}
                className={`flex items-center gap-1.5 text-xs transition-colors ${
                  isAddingHere && !guestMode ? 'text-violet-400' : 'text-slate-400 hover:text-violet-400'
                }`}
              >
                {isAddingHere && !guestMode ? <><X size={12} /> Cancel</> : <><UserPlus size={12} /> Add player</>}
              </button>
              <button
                onClick={() => {
                  if (isAddingHere && guestMode) { setAddingTo(null); setGuestMode(false); return; }
                  if (!verifyAdminPin()) return;
                  setAddingTo(key); setGuestMode(true);
                  setGuestForPlayer(session.players[0] ?? ''); setGuestName('');
                }}
                className={`flex items-center gap-1.5 text-xs transition-colors ${
                  isAddingHere && guestMode ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'
                }`}
              >
                {isAddingHere && guestMode ? <><X size={12} /> Cancel</> : <><Users size={12} /> Add guest</>}
              </button>
            </div>

            {isAddingHere && !guestMode && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {missingPlayers.length === 0 ? (
                  <div className="text-xs text-slate-500">All members already logged</div>
                ) : (
                  missingPlayers.map(p => (
                    <button
                      key={p.name}
                      onClick={() => handleAddPlayer(session, p.name)}
                      disabled={adding}
                      className="flex items-center gap-1.5 bg-violet-900/30 hover:bg-violet-900/50 border border-violet-700/30 rounded-full px-2 py-1 transition-colors"
                    >
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold"
                        style={{ background: p.color?.bg ?? '#334155', color: p.color?.fg ?? '#fff' }}
                      >{p.initials}</div>
                      <span className="text-xs text-violet-300 uppercase">{p.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {isAddingHere && guestMode && (
              <div className="mt-3 bg-white/[0.04] border border-violet-400/10 rounded-xl p-3 flex flex-col gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Brought by</label>
                  <div className="flex flex-wrap gap-1.5">
                    {session.players.map(name => {
                      const p = players.find(pl => pl.name === name);
                      return (
                        <button
                          key={name}
                          onClick={() => setGuestForPlayer(name)}
                          className={`flex items-center gap-1.5 rounded-full px-2 py-1 border text-xs transition-colors ${
                            guestForPlayer === name
                              ? 'bg-amber-900/40 border-amber-600/50 text-amber-300'
                              : 'bg-slate-700/50 border-slate-600/40 text-slate-400'
                          }`}
                        >
                          <div
                            className="w-4 h-4 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                            style={{ background: p?.color?.bg ?? '#1e293b', color: p?.color?.fg ?? '#aaa' }}
                          >{makeInitials(name)}</div>
                          <span className="uppercase">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Guest name</label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={e => setGuestName(e.target.value)}
                    placeholder={guestForPlayer ? `${guestForPlayer}'s guest` : 'Guest name'}
                    className="w-full bg-white/[0.04] border border-violet-400/15 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Skill level</label>
                  <div className="flex gap-1.5">
                    {(['E', 'I', 'B'] as GuestLevel[]).map(lvl => (
                      <button
                        key={lvl}
                        onClick={() => setGuestLevel(lvl)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                          guestLevel === lvl ? LEVEL_COLORS[lvl] : 'bg-transparent border-slate-700 text-slate-500'
                        }`}
                      >
                        <div>{lvl}</div>
                        <div className="text-xs font-normal opacity-75">{LEVEL_LABELS[lvl]}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleAddGuest(session)}
                  disabled={adding || !guestForPlayer}
                  className="w-full py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold"
                >
                  {adding ? 'Posting...' : 'Add Guest'}
                </button>
              </div>
            )}
          </div>
        )}

      {/* Admin: adjust per-player hours (partial sessions) */}
      {isAdmin && session.isDeducted && session.completedId && (() => {
        const isAdjusting = adjustingHoursFor === session.key;
        const maxH = session.sessionHours;
        const stepOptions: number[] = [];
        for (let h = 0.5; h <= maxH; h += 0.5) stepOptions.push(h);
        const getH = (name: string) => pendingHours[name] ?? maxH;
        const allNames = [...session.players, ...session.guests.map(g => g.name)];
        const totalH = allNames.reduce((sum, n) => sum + getH(n), 0);
        const rate = totalH > 0 ? session.totalCost / totalH : 0;
        const preview = session.players.map(name => {
          const gH = session.guests.filter(g => g.brought_by === name).reduce((s, g) => s + getH(g.name), 0);
          return { name, amount: Math.round((getH(name) + gH) * rate * 100) / 100 };
        });
        const hasChanges = Object.keys(pendingHours).length > 0;

        return isAdjusting ? (
          <div className="mt-3 neon-card !rounded-xl !p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Clock size={12} className="text-violet-400" />
                <span className="text-xs font-semibold text-violet-300">Adjust hours played</span>
              </div>
              <button onClick={() => { setAdjustingHoursFor(null); setPendingHours({}); }}
                className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
            </div>
            <div className="text-xs text-slate-500 mb-3">Session: {maxH}h · tap to override per person</div>
            <div className="flex flex-col gap-2 mb-3">
              {session.players.map(name => (
                <div key={name} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300 truncate flex-1">{name}</span>
                  <div className="flex gap-1">
                    {stepOptions.map(h => (
                      <button key={h} onClick={() => setPendingHours(p => ({ ...p, [name]: h }))}
                        className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${getH(name) === h ? 'btn-gradient border-transparent text-white' : 'bg-white/[0.04] border-violet-400/15 text-slate-400'}`}>
                        {h}h
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {session.guests.length > 0 && (
              <>
                <div className="text-xs text-slate-500 mb-2">Guests</div>
                <div className="flex flex-col gap-2 mb-3">
                  {session.guests.map((g, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-300 truncate flex-1">
                        {g.name} <span className="text-slate-500">→ {g.brought_by}</span>
                      </span>
                      <div className="flex gap-1">
                        {stepOptions.map(h => (
                          <button key={h} onClick={() => setPendingHours(p => ({ ...p, [g.name]: h }))}
                            className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${getH(g.name) === h ? 'btn-gradient border-transparent text-white' : 'bg-white/[0.04] border-violet-400/15 text-slate-400'}`}>
                            {h}h
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {hasChanges && (
              <div className="bg-white/[0.04] border border-violet-400/10 rounded-xl p-3 mb-3">
                <div className="text-xs text-slate-400 mb-2">Updated charges</div>
                {preview.map(({ name, amount }) => (
                  <div key={name} className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{name}</span>
                    <span className="text-[#ff6f91] font-medium">−${amount.toFixed(2)}</span>
                  </div>
                ))}
                <div className="text-[10px] text-slate-600 mt-2 pt-2 border-t border-white/5">
                  Total: ${preview.reduce((s, r) => s + r.amount, 0).toFixed(2)} of ${session.totalCost.toFixed(2)}
                </div>
              </div>
            )}
            <button
              disabled={!hasChanges || applyingHours}
              onClick={async () => {
                setApplyingHours(true);
                await handleUpdateSessionPlayerHours(session.completedId!, pendingHours, {
                  players: session.players,
                  guests: session.guests as { name: string; brought_by?: string }[],
                  totalCost: session.totalCost,
                  sessionHours: session.sessionHours,
                  sortDate: session.sortDate,
                  day: session.day,
                });
                setAdjustingHoursFor(null); setPendingHours({}); setApplyingHours(false);
              }}
              className="w-full py-2 rounded-xl btn-gradient hover:brightness-110 disabled:opacity-40 text-white text-xs font-semibold"
            >
              {applyingHours ? 'Applying...' : 'Apply & recalculate charges'}
            </button>
          </div>
        ) : (
          <button onClick={() => { setAdjustingHoursFor(session.key); setPendingHours({}); }}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-400 mt-2 transition-colors">
            <Clock size={11} /> Adjust hours played
          </button>
        );
      })()}
      </div>
    );
  };

  // ── JSX ───────────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 pt-4 pb-6">
      {isAdmin && (
        <div className="mb-3">
          <button
            onClick={() => setShowLogPast(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-900/20 hover:bg-amber-900/30 border border-amber-700/40 text-amber-300 text-sm font-semibold transition-colors"
          >
            <Plus size={14} /> Log past session
          </button>
        </div>
      )}

      {showLogPast && (
        <LogPastSessionModal
          players={players}
          ratePerCourt={ratePerCourt}
          onClose={() => setShowLogPast(false)}
          onSuccess={() => { loadCompletedSessions(); }}
          showToast={showToast}
        />
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <select
          value={selectedPlayer}
          onChange={e => setSelectedPlayer(e.target.value)}
          className="flex-1 bg-white/[0.04] border border-violet-400/15 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
        >
          <option value="">All Players</option>
          {players.map(p => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          className="flex-1 bg-white/[0.04] border border-violet-400/15 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
        >
          <option value="">All Months</option>
          {months.map(m => {
            const [year, mon] = m.split('-');
            const label = new Date(Number(year), Number(mon) - 1).toLocaleDateString('en-US', {
              month: 'long', year: 'numeric',
            });
            return <option key={m} value={m}>{label}</option>;
          })}
        </select>
      </div>

      {/* Turnout chart */}
      {!selectedPlayer && regularSessions.length >= 2 && (() => {
        const recent = regularSessions.slice(0, 8).slice().reverse();
        const maxP = Math.max(...recent.map(s => s.totalPeople), 1);
        return (
          <div className="neon-card mb-4">
            <div className="text-sm font-semibold text-slate-100">Turnout</div>
            <div className="text-xs text-slate-500 mb-3">last {recent.length} sessions</div>
            <div className="flex items-end justify-between gap-1.5" style={{ height: 104 }}>
              {recent.map((s, i) => {
                const h = Math.round((s.totalPeople / maxP) * 80) + 6;
                const [, mm, dd] = s.sortDate.split('-');
                const label = mm && dd ? `${Number(mm)}/${Number(dd)}` : '';
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <span className="text-[10px] text-slate-300 font-semibold">{s.totalPeople}</span>
                    <div className="w-full rounded-t-md" style={{ height: h, background: 'linear-gradient(180deg, #ff6f91, var(--accent))' }} />
                    <span className="text-[9px] text-slate-500 truncate w-full text-center">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Player stats card */}
      {selectedPlayer && playerStats && playerInfo && (
        <div className="neon-card card-rose mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
              style={{ background: playerInfo.color?.bg ?? '#1e293b', color: playerInfo.color?.fg ?? '#fff' }}
            >{makeInitials(selectedPlayer)}</div>
            <div>
              <div className="text-base font-semibold text-slate-100">{selectedPlayer}</div>
              <div className="text-xs text-slate-400">
                Balance: <span className={playerInfo.balance < 15 ? 'text-red-400' : 'text-emerald-400'}>
                  ${playerInfo.balance.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/[0.05] border border-violet-400/10 rounded-xl p-2.5">
              <div className="text-xs text-slate-400 mb-0.5">Sessions Played</div>
              <div className="text-xl font-bold text-violet-400">{playerStats.sessionsCount}</div>
            </div>
            <div className="bg-white/[0.05] border border-violet-400/10 rounded-xl p-2.5">
              <div className="text-xs text-slate-400 mb-0.5">Total Charged</div>
              <div className="text-xl font-bold text-red-400">${playerStats.totalPaid.toFixed(2)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Session list */}
      {filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-10">
          <div className="text-sm">No historical sessions stored yet</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(session =>
            session.type === 'extra'
              ? renderExtraCard(session)
              : renderRegularCard(session)
          )}
        </div>
      )}
    </div>
  );
}