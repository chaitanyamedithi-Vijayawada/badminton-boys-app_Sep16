// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { COLORS, makeInitials, getWeekKey, getUpcomingSessionWeekKey, getCompletedWeekKey, parseCourtSplit } from '../lib/constants';
import { isSessionEndPassed, isExtraSessionEnded } from '../lib/cutoff';
import { computeSessionCost, computePerPerson, computeFinalizeCharges, computeAdjustedCharges } from '../lib/sessionMath';
import { hashPin, verifyPin } from '../lib/crypto';
import { notifySessionComplete, sendSessionEmail, registerPlayerForNotifications } from '../lib/notifications';
import { computeWaitlist, type Attendee } from '../lib/waitlist';
import type {
  Player, Day, RsvpData, GuestData, GuestEntry, CourtData, AttendanceRecord,
  CompletedSession, Payment, PlayerTransfer, CourtPayment, MiscExpense,
  FinanceHistoryEntry, ExtraSession, ExtraSessionRsvp, ExtraSessionGuest, TabId,
} from '../types';

interface AppContextValue {
  // Auth / identity
  myName: string;
  setMyName: (name: string) => void;
  currentUser: { id?: string; name?: string; role?: string } | null;

  // UI
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  hiddenTabs: TabId[];
  toggleTabVisibility: (tab: TabId) => void;
  showNamePicker: boolean;
  setShowNamePicker: (v: boolean) => void;
  dataReady: boolean;
  fontSize: number;
  toast: { visible: boolean; message: string };
  showToast: (msg: string) => void;
  refreshTab: () => Promise<void>;

  // Admin PIN
  pinVerified: boolean;
  verifyAdminPin: () => boolean;
  submitPin: (pin: string) => boolean;

  // Player PIN login
  isLoggedIn: boolean;
  loginWithPin: (name: string, pin: string) => Promise<boolean>;
  setupPin: (name: string, pin: string) => Promise<void>;
  resetPlayerPin: (playerId: string) => Promise<void>;
  logout: () => void;

  // Players & wallets
  players: Player[];
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  loadPlayers: () => Promise<void>;
  handleSettleAndArchive: (playerName: string) => Promise<void>;
  handleUnarchivePlayer: (playerName: string) => Promise<void>;
  loadWallets: () => Promise<void>;

  // Settings
  settings: Record<string, string>;
  loadSettings: () => Promise<void>;

  // RSVP / sessions
  rsvpData: RsvpData;
  guestData: GuestData;
  setGuestData: React.Dispatch<React.SetStateAction<GuestData>>;
  courtData: CourtData;
  setCourtData: React.Dispatch<React.SetStateAction<CourtData>>;
  ratePerCourt: number;
  setRatePerCourt: (rate: number) => void;
  loadRSVPs: () => Promise<void>;
  rsvpTimestamps: { saturday: Record<string, string>; wednesday: Record<string, string> };
  rsvpHours: { saturday: Record<string, number>; wednesday: Record<string, number> };
  handleSetRsvpHours: (day: Day, playerName: string, hours: number) => Promise<void>;

  // Attendance & history
  attendanceData: AttendanceRecord[];
  loadAttendance: () => Promise<void>;

  // Completed sessions
  completedSessions: CompletedSession[];
  loadCompletedSessions: () => Promise<void>;
  completeSession: (day: Day, totalCostOverride?: number) => Promise<void>;
  handleUpdateSessionPlayerHours: (
    completedSessionId: string | number,
    playerHours: Record<string, number>,
    sessionData: {
      players: string[];
      guests: { name: string; brought_by?: string }[];
      totalCost: number;
      sessionHours: number;
      sortDate: string;
      day: string;
    }
  ) => Promise<void>;
  handleUpdateSessionCourts: (
    completedSessionId: string | number,
    newCourtCount: number,
    sessionData: {
      players: string[];
      guests: { name: string; brought_by?: string }[];
      sessionHours: number;
      ratePerCourt: number;
      playerHours?: Record<string, number>;
      currentCourts?: number[];
      sortDate: string;
      day: string;
    }
  ) => Promise<void>;
  handleSendSessionEmails: (day: Day) => Promise<void>;
  handleSendExtraSessionEmails: (sessionId: number) => Promise<void>;
  handleToggleExtraSessionLock: (id: number, locked: boolean) => Promise<void>;
  completeExtraSession: (sessionId: number, totalCostOverride?: number) => Promise<void>;

  // Payments
  pendingPayments: Payment[];
  loadPendingPayments: () => Promise<void>;
  confirmedPayments: Payment[];

  // Player transfers
  playerTransfers: PlayerTransfer[];
  loadPlayerTransfers: () => Promise<void>;

  // Finance
  courtPayments: CourtPayment[];
  miscExpenses: MiscExpense[];
  loadMiscExpenses: () => Promise<void>;
  financeHistory: FinanceHistoryEntry[];
  loadFinanceHistory: () => Promise<void>;
  remainingFunds: number;
  remainingHours: number;
  activePlayerCount: number;

  // Extra sessions
  extraSessions: ExtraSession[];
  loadExtraSessions: () => Promise<void>;
  extraSessionRsvps: ExtraSessionRsvp[];
  loadExtraSessionRsvps: () => Promise<void>;
  extraSessionGuests: ExtraSessionGuest[];
  loadExtraSessionGuests: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

function buildPlayerFromRow(
  row: {
    id?: string;
    name: string;
    skill: string | null;
    email?: string | null;
    role?: string;
    pin?: string | null;
    emoji?: string | null;
    archived?: boolean | null;
    shirt_size?: string | null;
    avatar_url?: string | null;
  },
  index: number,
  balanceMap: Record<string, number>
): Player {
  const color = COLORS[index % COLORS.length];
  const initials = makeInitials(row.name);
  const balance = balanceMap[row.id ?? ''] ?? balanceMap[row.name] ?? 0;
  return {
    id: row.id,
    name: row.name,
    skill: row.skill,
    balance,
    color,
    initials,
    email: row.email ?? null,
    role: row.role ?? 'player',
    pin: row.pin ?? null,
    emoji: row.emoji ?? null,
    archived: row.archived ?? false,
    shirt_size: row.shirt_size ?? null,
    avatar_url: row.avatar_url ?? null,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  // ── Identity ─────────────────────────────────────────────────────────────────
  const [myName, setMyNameState] = useState<string>(() => localStorage.getItem('lb_name') || '');
  const setMyName = useCallback((name: string) => {
    setMyNameState(name);
    if (name) localStorage.setItem('lb_name', name);
    else localStorage.removeItem('lb_name');
  }, []);

  // ── UI ───────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('sessions');
  const [hiddenTabs, setHiddenTabs] = useState<TabId[]>(() => {
    try {
      const stored = localStorage.getItem('lb_hidden_tabs');
      if (stored) return JSON.parse(stored) as TabId[];
    } catch { /* ignore */ }
    // Match tab is hidden by default since it's rarely used
    return ['match'];
  });
  const toggleTabVisibility = useCallback((tab: TabId) => {
    setHiddenTabs(prev => {
      const next = prev.includes(tab)
        ? prev.filter(t => t !== tab)
        : [...prev, tab];
      localStorage.setItem('lb_hidden_tabs', JSON.stringify(next));
      return next;
    });
  }, []);
  const [showNamePicker, setShowNamePicker] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [fontSize] = useState(100);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast({ visible: true, message: msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast({ visible: false, message: '' }), 3000);
  }, []);

  // ── Admin PIN ────────────────────────────────────────────────────────────────
  const [pinVerified, setPinVerified] = useState(false);

  // ── Player PIN login ──────────────────────────────────────────────────────────
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    return localStorage.getItem('lb_logged_in') === 'true';
  });

  const loginWithPin = useCallback(async (name: string, pin: string): Promise<boolean> => {
    const { data } = await supabase
      .from('players')
      .select('pin')
      .eq('name', name)
      .single();
    if (!data?.pin) return false;
    const ok = await verifyPin(pin, data.pin);
    if (ok) {
      setIsLoggedIn(true);
      localStorage.setItem('lb_logged_in', 'true');
    }
    return ok;
  }, []);

  const setupPin = useCallback(async (name: string, pin: string): Promise<void> => {
    const hashed = await hashPin(pin);
    await supabase.from('players').update({ pin: hashed }).eq('name', name);
    setIsLoggedIn(true);
    localStorage.setItem('lb_logged_in', 'true');
    await loadPlayers();
  }, []);

  const resetPlayerPin = useCallback(async (playerId: string): Promise<void> => {
    await supabase.from('players').update({ pin: null }).eq('id', playerId);
    await loadPlayers();
  }, []);

  const logout = useCallback(() => {
    setMyName('');
    setIsLoggedIn(false);
    localStorage.removeItem('lb_name');
    localStorage.removeItem('lb_logged_in');
  }, [setMyName]);

  // ── Players & Ledger Realignment ──────────────────────────────────────────────
  const [players, setPlayers] = useState<Player[]>([]);
  const playerRowsRef = useRef<{ id?: string; name: string; skill: string | null; email?: string | null; role?: string; pin?: string | null; emoji?: string | null }[]>([]);

  const loadWallets = useCallback(async () => {
    const { data: txns } = await supabase.from('transactions').select('player_id, amount');
    const balanceMap: Record<string, number> = {};
    (txns ?? []).forEach((t: { player_id: string; amount: number }) => {
      balanceMap[t.player_id] = (balanceMap[t.player_id] || 0) + Number(t.amount);
    });
    setPlayers(
      playerRowsRef.current.map((row, i) => buildPlayerFromRow(row, i, balanceMap))
    );
  }, []);

  const loadPlayers = useCallback(async () => {
    const { data: playerRows } = await supabase
  .from('players')
  .select('id, name, skill, email, role, pin, emoji, archived, shirt_size, avatar_url')
  .order('name');
    const { data: txns } = await supabase.from('transactions').select('player_id, amount');
    const balanceMap: Record<string, number> = {};
    (txns ?? []).forEach((t: { player_id: string; amount: number }) => {
      balanceMap[t.player_id] = (balanceMap[t.player_id] || 0) + Number(t.amount);
    });
    const rows = playerRows ?? [];
    playerRowsRef.current = rows;
    setPlayers(rows.map((row, i) => buildPlayerFromRow(row, i, balanceMap)));
  }, []);

  // ── Settings ─────────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [ratePerCourt, setRatePerCourt] = useState(45.40);
  const [courtData, setCourtData] = useState<CourtData>({ saturday: [1, 2], wednesday: [1, 2] });

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from('settings').select('key, value');
    const map: Record<string, string> = {};
    (data ?? []).forEach((s: { key: string; value: string }) => { map[s.key] = s.value; });
    setSettings(map);
    if (map.court_rate) setRatePerCourt(parseFloat(map.court_rate) * 2);
    if (map.courts_saturday) {
      try { setCourtData(prev => ({ ...prev, saturday: JSON.parse(map.courts_saturday) })); } catch { /* ignore */ }
    }
    if (map.courts_wednesday) {
      try { setCourtData(prev => ({ ...prev, wednesday: JSON.parse(map.courts_wednesday) })); } catch { /* ignore */ }
    }
  }, []);

  // ── Admin PIN verification (needs settings, declared above) ──────────────────
  const verifyAdminPin = useCallback((): boolean => {
    if (pinVerified) return true;
    const pin = window.prompt('Enter admin PIN:');
    if (pin && pin === settings.admin_pin) {
      setPinVerified(true);
      return true;
    }
    return false;
  }, [pinVerified, settings]);

  const submitPin = useCallback((pin: string): boolean => {
    if (pin && pin === settings.admin_pin) {
      setPinVerified(true);
      return true;
    }
    return false;
  }, [settings]);

  // ── RSVPs / Guests ───────────────────────────────────────────────────────────
  const [rsvpData, setRsvpData] = useState<RsvpData>({ saturday: {}, wednesday: {} });
  const [guestData, setGuestData] = useState<GuestData>({ saturday: [], wednesday: [] });

  const [rsvpTimestamps, setRsvpTimestamps] = useState<{ saturday: Record<string, string>; wednesday: Record<string, string> }>({ saturday: {}, wednesday: {} });
  const [rsvpHours, setRsvpHours] = useState<{ saturday: Record<string, number>; wednesday: Record<string, number> }>({ saturday: {}, wednesday: {} });

  const loadRSVPs = useCallback(async () => {
    // Roll-forward semantics: each day-tab (Saturday, Wednesday) advances to
    // the NEXT week's session as soon as this week's session ends. So Sat
    // RSVPs and Wed RSVPs can live in DIFFERENT week keys (e.g. after Wed
    // ends but before Sat plays: Wed = next week, Sat = this week). Load a
    // small superset of weeks and pick per-day so both tabs see fresh data.
    const satWeek = getUpcomingSessionWeekKey('saturday');
    const wedWeek = getUpcomingSessionWeekKey('wednesday');
    const uniqueWeeks = Array.from(new Set([satWeek, wedWeek]));

    const { data: rsvps } = await supabase
      .from('rsvps')
      .select('week, day, player_name, status, hours')
      .in('week', uniqueWeeks);
    const newRsvpData: RsvpData = { saturday: {}, wednesday: {} };
    const newHours: { saturday: Record<string, number>; wednesday: Record<string, number> } = { saturday: {}, wednesday: {} };
    (rsvps ?? []).forEach((r: { week: string; day: Day; player_name: string; status: 'going' | 'skip'; hours?: number | null }) => {
      if (r.day !== 'saturday' && r.day !== 'wednesday') return;
      const effective = r.day === 'saturday' ? satWeek : wedWeek;
      if (r.week !== effective) return;
      newRsvpData[r.day][r.player_name] = r.status;
      if (r.hours != null) newHours[r.day][r.player_name] = r.hours;
    });
    setRsvpData(newRsvpData);
    setRsvpHours(newHours);

    // Timestamps are optional — fetch separately so a missing column never
    // breaks the core RSVP data above.
    const newTimestamps: { saturday: Record<string, string>; wednesday: Record<string, string> } = { saturday: {}, wednesday: {} };
    try {
      const { data: tsRows } = await supabase
        .from('rsvps')
        .select('week, day, player_name, voted_at')
        .in('week', uniqueWeeks);
      (tsRows ?? []).forEach((r: { week: string; day: Day; player_name: string; voted_at?: string | null }) => {
        if ((r.day !== 'saturday' && r.day !== 'wednesday') || !r.voted_at) return;
        const effective = r.day === 'saturday' ? satWeek : wedWeek;
        if (r.week !== effective) return;
        newTimestamps[r.day][r.player_name] = r.voted_at;
      });
    } catch { /* voted_at column may not exist yet — timestamps won't show */ }
    setRsvpTimestamps(newTimestamps);

    const { data: guests } = await supabase
      .from('guests')
      .select('week, day, brought_by, friends')
      .in('week', uniqueWeeks);
    const newGuestData: GuestData = { saturday: [], wednesday: [] };
    (guests ?? []).forEach((g: { week: string; day: Day; brought_by: string; friends: string }) => {
      if (g.day !== 'saturday' && g.day !== 'wednesday') return;
      const effective = g.day === 'saturday' ? satWeek : wedWeek;
      if (g.week !== effective) return;
      let friends: { name: string; level?: string }[] = [];
      try { friends = JSON.parse(g.friends); } catch { /* ignore */ }
      friends.forEach(f => {
        newGuestData[g.day].push({ name: f.name, brought_by: g.brought_by, level: f.level as GuestEntry['level'] });
      });
    });
    setGuestData(newGuestData);
  }, []);

  const handleSettleAndArchive = useCallback(async (playerName: string) => {
    const player = players.find(p => p.name === playerName);
    if (!player?.id) return;
    const balance = player.balance;
    if (Math.abs(balance) >= 0.01) {
      const type = balance > 0 ? 'misc_charge' : 'top_up';
      const amount = balance > 0 ? -Math.round(balance * 100) / 100 : Math.round(Math.abs(balance) * 100) / 100;
      await supabase.from('transactions').insert({
        player_id: player.id, type, amount,
        note: 'Settlement — player archived',
        created_at: new Date().toISOString(),
      });
    }
    await supabase.from('players').update({ archived: true }).eq('id', player.id);
    await loadPlayers();
    await loadWallets();
    showToast(`${playerName} settled & archived ✓`);
  }, [players, loadPlayers, loadWallets, showToast]);

  const handleUnarchivePlayer = useCallback(async (playerName: string) => {
    const player = players.find(p => p.name === playerName);
    if (!player?.id) return;
    await supabase.from('players').update({ archived: false }).eq('id', player.id);
    await loadPlayers();
    showToast(`${playerName} unarchived ✓`);
  }, [players, loadPlayers, showToast]);

  const handleSetRsvpHours = useCallback(async (day: Day, playerName: string, hours: number) => {    const week = getWeekKey();
    await supabase.from('rsvps')
      .update({ hours })
      .eq('week', week)
      .eq('day', day)
      .eq('player_name', playerName);
    await loadRSVPs();
  }, [loadRSVPs]);

  // ── Attendance ───────────────────────────────────────────────────────────────
  const [attendanceData, setAttendanceData] = useState<AttendanceRecord[]>([]);

  const loadAttendance = useCallback(async () => {
    const { data } = await supabase
      .from('attendance')
      .select('id, week, day, player_name, created_at')
      .order('created_at', { ascending: false });
    setAttendanceData(data ?? []);
  }, []);

  // ── Completed Sessions ───────────────────────────────────────────────────────
  const [completedSessions, setCompletedSessions] = useState<CompletedSession[]>([]);

  const loadCompletedSessions = useCallback(async () => {
    const { data } = await supabase
      .from('completed_sessions')
      .select('*')
      .order('created_at', { ascending: false });
    setCompletedSessions(data ?? []);
  }, []);

  // ── Complete Session Logic ───────────────────────────────────────────────────
  const completeSession = useCallback(async (day: Day, totalCostOverride?: number) => {
    // Guard: never finalize before the session has actually ended. Without
    // this, an admin could finalize on Sunday/Monday (before the session date)
    // and deduct money from balances before the session was played.
    if (!isSessionEndPassed(day, 9, day === 'wednesday'
      ? (Number(settings['wed_end_hour']) || 20) : 9)) {
      showToast('Session has not ended yet — cannot finalize');
      return;
    }

    // Use the completed-week key so a session finalized on Sunday/Monday is
    // recorded against the week that just ended, not the upcoming week. This
    // prevents charges from being applied to the wrong (future) session.
    const week = getCompletedWeekKey();
    const existing = completedSessions.find(s => s.week === week && s.day === day);
    if (existing) return;

    // Authoritative guard: never re-finalize a session that already exists in the
    // database, even if local state is stale (e.g. a fresh load where the
    // auto-finalizer fires before completedSessions has loaded). Without this, a
    // re-run would overwrite the row via the onConflict upsert — wiping out late
    // edits like added players — and could re-insert charge transactions.
    const { data: existingRows } = await supabase
      .from('completed_sessions')
      .select('id')
      .eq('week', week)
      .eq('day', day)
      .limit(1);
    if (existingRows && existingRows.length > 0) return;

    // Query RSVPs and guests directly from the DB using the this-week key.
    // Don't rely on context state (rsvpData/guestData): those may have already
    // rolled forward to the next session week (via getUpcomingSessionWeekKey),
    // so on Sat morning after 9 AM the context state points to Sep 19 while
    // this finalize path is trying to close out Sep 12. Reading from DB by
    // the this-week key `week` avoids the mismatch entirely.
    const { data: dbRsvps } = await supabase
      .from('rsvps')
      .select('player_name, status')
      .eq('week', week).eq('day', day);
    const rsvps: Record<string, 'going' | 'skip'> = {};
    (dbRsvps ?? []).forEach((r: { player_name: string; status: 'going' | 'skip' }) => {
      rsvps[r.player_name] = r.status;
    });

    const { data: dbGuests } = await supabase
      .from('guests')
      .select('brought_by, friends')
      .eq('week', week).eq('day', day);
    const guestsAll: GuestEntry[] = [];
    (dbGuests ?? []).forEach((g: { brought_by: string; friends: string }) => {
      let friends: { name: string; level?: string }[] = [];
      try { friends = JSON.parse(g.friends); } catch { /* ignore */ }
      friends.forEach(f => {
        guestsAll.push({
          name: f.name,
          brought_by: g.brought_by,
          level: f.level as GuestEntry['level'],
        });
      });
    });

    const courts = courtData[day];
    const goingAll = Object.entries(rsvps).filter(([, s]) => s === 'going').map(([n]) => n);

    if (goingAll.length < 3) return;

    // Waitlist-aware finalization: only accepted players/guests are charged.
    // Compute accepted vs waitlisted using voted_at ordering — this mirrors
    // what the Home tab shows. Waitlisted people don't play so they don't pay.
    const { data: tsRowsForFinalize } = await supabase
      .from('rsvps')
      .select('player_name, voted_at')
      .eq('week', week).eq('day', day).eq('status', 'going');
    const votedAtMap: Record<string, string> = {};
    (tsRowsForFinalize ?? []).forEach((r: { player_name: string; voted_at?: string | null }) => {
      if (r.voted_at) votedAtMap[r.player_name] = r.voted_at;
    });
    const attendeeInput: Attendee[] = [
      ...goingAll.map(n => ({ name: n, isGuest: false, votedAt: votedAtMap[n] || '' })),
      ...guestsAll.map((g: GuestEntry) => ({
        name: g.name, isGuest: true, broughtBy: g.brought_by,
        votedAt: (g.brought_by ? (votedAtMap[g.brought_by] || '') : '') + '~guest',
      })),
    ];
    const wait = computeWaitlist(attendeeInput);
    const goingPlayers = wait.accepted.filter(a => !a.isGuest).map(a => a.name);
    const guests = wait.accepted
      .filter(a => a.isGuest)
      .map(a => guestsAll.find(g => g.name === a.name && g.brought_by === a.broughtBy))
      .filter((g): g is GuestEntry => !!g);
    // Courts to bill = the number that auto-opened for this session, not the
    // admin's manual court list (which is now moot per the waitlist system).
    const autoCourtsCount = wait.courtsOpen;
    const autoCourtsList = Array.from({ length: autoCourtsCount }, (_, i) => i + 1);
    void courts; // manual court list retained in code but not billed against

    const totalPeople = goingPlayers.length + guests.length;
    // Admin-set session length (hours per court), default 2. Stored per week+day
    // so it never carries over to the next session.
    const sessionHours = Number(settings[`session_hours_${week}_${day}`]) || 2;

    // Split-court support: when the admin enables "split court" for this day, the
    // cost is the sum of court-hours across segments (e.g. 3 courts×1h + 4×1h = 7
    // court-hours) rather than a flat courts × hours. A manually-typed cost
    // override still takes precedence over everything.
    const split = parseCourtSplit(settings[`court_split_${day}`]);
    const { totalCost, effectiveCourtsCount, effectiveSessionHours } = computeSessionCost({
      totalCostOverride, split, courtsCount: autoCourtsCount, sessionHours, ratePerCourt,
    });
    const perPerson = computePerPerson(totalCost, totalPeople);
    // Session date must be the actual play date (Saturday or the Wednesday
    // 3 days before that Saturday), NOT "today in UTC". If admin finalizes
    // Saturday evening Pacific, UTC has already rolled to Sunday and
    // `new Date().toISOString().split('T')[0]` returns tomorrow's date —
    // making emails and history say the session was on Sunday. Derive from
    // the week key instead so the stored date is always correct.
    const sessionDate = (() => {
      if (day === 'saturday') return week;
      // Wednesday is 3 days before that Saturday.
      const [y, m, d] = week.split('-').map(Number);
      const wed = new Date(Date.UTC(y, m - 1, d - 3));
      const yy = wed.getUTCFullYear();
      const mm = String(wed.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(wed.getUTCDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    })();

    const { data: newSession, error: sessionErr } = await supabase.from('completed_sessions').upsert({
      week,
      day,
      session_date: sessionDate,
      players: goingPlayers,
      guests: guests.map((g: GuestEntry) => ({ name: g.name, brought_by: g.brought_by })),
      courts: autoCourtsList,
      courts_count: effectiveCourtsCount,
      rate_per_court: ratePerCourt,
      session_hours: effectiveSessionHours,
      total_cost: totalCost,
      players_count: totalPeople,
      per_person: perPerson,
      auto_deducted: true,
      is_extra: false,
    }, { onConflict: 'week,day' }).select().single();

    if (sessionErr || !newSession) {
      showToast('Error completing session metadata');
      return;
    }

    try {
      const uniqueNamesToLookup = Array.from(new Set([
        ...goingPlayers,
        ...guests.map((g: GuestEntry) => g.brought_by).filter(Boolean),
      ])) as string[];

      const { data: matchedPlayers, error: playerLookupErr } = await supabase
        .from('players')
        .select('id, name')
        .in('name', uniqueNamesToLookup);

      if (playerLookupErr || !matchedPlayers) throw new Error('Could not resolve player UUID profiles');

      const nameToIdMap: Record<string, string> = {};
      matchedPlayers.forEach((p: { id: string; name: string }) => { nameToIdMap[p.name] = p.id; });

      // Fetch per-player hours (default 2 if not set)
      const { data: hoursRows } = await supabase
        .from('rsvps')
        .select('player_name, hours')
        .eq('week', week).eq('day', day).eq('status', 'going');
      const hoursMap: Record<string, number> = {};
      (hoursRows ?? []).forEach((r: { player_name: string; hours?: number | null }) => {
        hoursMap[r.player_name] = r.hours ?? 2;
      });

      // Player-hours model — pure math lives in lib/sessionMath (unit-tested).
      const { playerCharges, guestCharges } = computeFinalizeCharges({
        goingPlayers, guests, hoursMap, totalCost,
      });

      const ledgerTxns: Record<string, unknown>[] = [];

      playerCharges.forEach(({ name, amount }) => {
        const playerId = nameToIdMap[name];
        if (playerId) {
          ledgerTxns.push({
            player_id: playerId,
            type: 'match_charge',
            amount: -amount,
            session_id: String(newSession.id),
            note: `Match — ${sessionDate} · ${day} (${week})`,
          });
        }
      });

      guestCharges.forEach(({ host, guest, amount }) => {
        const hostId = nameToIdMap[host];
        if (hostId) {
          ledgerTxns.push({
            player_id: hostId,
            type: 'match_charge',
            amount: -amount,
            session_id: String(newSession.id),
            note: `Guest Charge — ${guest} hosted by ${host} · ${sessionDate}`,
          });
        }
      });

      if (ledgerTxns.length > 0) {
        const { error: txPostErr } = await supabase.from('transactions').insert(ledgerTxns);
        if (txPostErr) throw txPostErr;
      }

      showToast('Session finalized — use "Send emails" to notify players.');

    } catch (txnError: unknown) {
      await supabase.from('completed_sessions').update({ auto_deducted: false }).eq('id', Number(newSession.id));
      const msg = txnError instanceof Error ? txnError.message : String(txnError);
      showToast(`Ledger distribution failed: ${msg}`);
    }

    await loadCompletedSessions();
    await loadWallets();
  }, [completedSessions, rsvpData, guestData, courtData, ratePerCourt, settings, players, loadCompletedSessions, loadWallets, showToast]);

  // ── Per-player hour adjustments ───────────────────────────────────────────
  // Recalculates all charges for a completed session using a player-hours model.
  // Only overrides are stored in playerHours; absent names default to sessionHours.
  // Deletes all existing match_charge transactions and re-inserts one clean
  // transaction per named player (which includes their guests' hours).
  const handleUpdateSessionPlayerHours = useCallback(async (
    completedSessionId: string | number,
    playerHours: Record<string, number>,
    sessionData: {
      players: string[];
      guests: { name: string; brought_by?: string }[];
      totalCost: number;
      sessionHours: number;
      sortDate: string;
      day: string;
    }
  ) => {
    const adjusted = computeAdjustedCharges({
      players: sessionData.players,
      guests: sessionData.guests,
      playerHours,
      sessionHours: sessionData.sessionHours,
      totalCost: sessionData.totalCost,
    });
    if (!adjusted) { showToast('Cannot apply — total hours is 0'); return; }
    const chargeByName: Record<string, number> = {};
    adjusted.playerCharges.forEach(c => { chargeByName[c.name] = c.amount; });

    const sid = String(completedSessionId);
    const { error: delErr } = await supabase
      .from('transactions').delete()
      .eq('session_id', sid).eq('type', 'match_charge');
    if (delErr) { showToast(`Error: ${delErr.message}`); return; }

    const newTxns = sessionData.players.map(name => {
      const player = players.find(p => p.name === name);
      if (!player) return null;
      const charge = chargeByName[name] ?? 0;
      return {
        player_id: player.id,
        type: 'match_charge',
        amount: -charge,
        session_id: sid,
        note: `Match — ${sessionData.sortDate} · ${sessionData.day} (${sessionData.sortDate})`,
        created_at: new Date().toISOString(),
      };
    }).filter(Boolean);

    const { error: insErr } = await supabase.from('transactions').insert(newTxns);
    if (insErr) { showToast(`Error: ${insErr.message}`); return; }

    await supabase.from('completed_sessions')
      .update({ player_hours: playerHours })
      .eq('id', Number(completedSessionId));

    await loadCompletedSessions();
    await loadWallets();
    showToast('Hours updated — charges recalculated ✓');
  }, [players, loadCompletedSessions, loadWallets, showToast]);

  // ── Edit court count on an already-logged session ─────────────────────────────
  // For the "forgot to switch off a court" case: recomputes total cost from the
  // new court count (courts × rate/2 × hours), redistributes charges across
  // players (respecting any per-player hours already set), and rewrites both the
  // ledger rows and the completed_sessions row. Uses the same computeSessionCost
  // / computeAdjustedCharges math as finalize, so it stays consistent.
  const handleUpdateSessionCourts = useCallback(async (
    completedSessionId: string | number,
    newCourtCount: number,
    sessionData: {
      players: string[];
      guests: { name: string; brought_by?: string }[];
      sessionHours: number;
      ratePerCourt: number;
      playerHours?: Record<string, number>;
      currentCourts?: number[];
      sortDate: string;
      day: string;
    }
  ) => {
    if (newCourtCount < 1) { showToast('Court count must be at least 1'); return; }

    // New total cost from the corrected court count (no split, no override —
    // this is the flat recompute appropriate for a manual court fix).
    const { totalCost } = computeSessionCost({
      totalCostOverride: null,
      split: null,
      courtsCount: newCourtCount,
      sessionHours: sessionData.sessionHours,
      ratePerCourt: sessionData.ratePerCourt,
    });

    // Redistribute across players using existing per-player hours if present,
    // otherwise everyone at the session's default hours.
    const adjusted = computeAdjustedCharges({
      players: sessionData.players,
      guests: sessionData.guests,
      playerHours: sessionData.playerHours ?? {},
      sessionHours: sessionData.sessionHours,
      totalCost,
    });
    if (!adjusted) { showToast('Cannot apply — total hours is 0'); return; }
    const chargeByName: Record<string, number> = {};
    adjusted.playerCharges.forEach(c => { chargeByName[c.name] = c.amount; });

    const sid = String(completedSessionId);
    const { error: delErr } = await supabase
      .from('transactions').delete()
      .eq('session_id', sid).eq('type', 'match_charge');
    if (delErr) { showToast(`Error: ${delErr.message}`); return; }

    const newTxns = sessionData.players.map(name => {
      const player = players.find(p => p.name === name);
      if (!player) return null;
      const charge = chargeByName[name] ?? 0;
      return {
        player_id: player.id,
        type: 'match_charge',
        amount: -charge,
        session_id: sid,
        note: `Match — ${sessionData.sortDate} · ${sessionData.day}`,
        created_at: new Date().toISOString(),
      };
    }).filter(Boolean);

    const { error: insErr } = await supabase.from('transactions').insert(newTxns);
    if (insErr) { showToast(`Error: ${insErr.message}`); return; }

    const totalPeople = sessionData.players.length + sessionData.guests.length;
    // Trim the stored court-name list to match the new count so the UI chips
    // reflect reality (e.g. [6,7] → [6] when reducing 2 courts to 1). Falls back
    // to a simple numbered list if we weren't given the current names.
    const trimmedCourts = (sessionData.currentCourts && sessionData.currentCourts.length >= newCourtCount)
      ? sessionData.currentCourts.slice(0, newCourtCount)
      : Array.from({ length: newCourtCount }, (_, i) => i + 1);
    await supabase.from('completed_sessions')
      .update({
        courts: trimmedCourts,
        courts_count: newCourtCount,
        total_cost: totalCost,
        per_person: computePerPerson(totalCost, totalPeople),
      })
      .eq('id', Number(completedSessionId));

    await loadCompletedSessions();
    await loadWallets();
    showToast(`Courts updated to ${newCourtCount} — charges recalculated ✓`);
  }, [players, loadCompletedSessions, loadWallets, showToast]);

  // ── Send session emails (manual — admin triggers after confirming everything) ─
  const handleSendSessionEmails = useCallback(async (day: Day) => {
    // Find the most recently completed session for this day — don't rely on
    // the live getWeekKey(), since that always points to the upcoming Saturday
    // and goes stale if admin sends emails even a day after finalizing.
    const candidates = completedSessions
      .filter(s => s.day === day && !s.is_extra)
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    const cs = candidates[0];
    if (!cs) { showToast('No completed session found for ' + day); return; }

    const { data: txns } = await supabase
      .from('transactions').select('player_id, amount')
      .eq('session_id', String(cs.id)).eq('type', 'match_charge');

    const chargeMap: Record<string, number> = {};
    (txns ?? []).forEach((t: { player_id: number | null; amount: number }) => {
      if (t.player_id != null) chargeMap[String(t.player_id)] = Math.abs(t.amount);
    });

    const { data: freshEmails } = await supabase.from('players').select('name, email');
    const emailMap: Record<string, string> = {};
    (freshEmails ?? []).forEach((p: { name: string; email?: string | null }) => {
      if (p.email) emailMap[p.name] = p.email;
    });

    const sessionPlayers: string[] = cs.players ?? [];
    const sessionGuests: { name: string; brought_by?: string }[] = cs.guests ?? [];
    const perPerson = cs.per_person;
    const sessionDate = cs.session_date ?? '';

    let sessionTime = '7:00 AM – 9:00 AM';
    if (day === 'wednesday') {
      try {
        const wedTime = JSON.parse(settings.wed_time || '{}');
        if (wedTime.start && wedTime.end) sessionTime = `${wedTime.start} – ${wedTime.end}`;
      } catch { /* fallback */ }
    }

    const notifyPlayers = sessionPlayers.map(name => {
      const playerObj = players.find(p => p.name === name);
      const guestCount = sessionGuests.filter(g => g.brought_by === name).length;
      const charge = playerObj ? (chargeMap[String(playerObj.id)] ?? perPerson * (1 + guestCount)) : perPerson;
      const newBalance = playerObj?.balance ?? 0;
      const totalDeducted = perPerson * (1 + guestCount);
      const oldBalance = newBalance + totalDeducted;
      return { name, oldBalance, newBalance, guestCount: guestCount || undefined };
    });

    notifySessionComplete({
      day, week: cs.week, perPerson, totalCost: cs.total_cost,
      courtsCount: cs.courts_count, players: notifyPlayers,
    });

    const result = await sendSessionEmail({
      day, week: cs.week, sessionDate, sessionTime,
      hoursPlayed: cs.courts_count * (cs.session_hours ?? 2),
      courtsCount: cs.courts_count, playersCount: cs.players_count, perPerson,
      allPlayerNames: [...sessionPlayers, ...sessionGuests.map(g => g.name)],
      players: notifyPlayers.map(p => ({
        ...p, email: emailMap[p.name] ?? '', guestCount: p.guestCount ?? 0,
      })),
    });

    if (result.eligible === 0) {
      showToast('No players have an email saved — nothing to send.');
    } else if (result.failed === 0) {
      showToast(`Emails sent to ${result.sent} player${result.sent !== 1 ? 's' : ''} ✓`);
    } else if (result.sent === 0) {
      showToast(`Email send failed for all ${result.failed} — check Resend setup.`);
    } else {
      showToast(`Sent ${result.sent}, failed ${result.failed} — check Resend setup.`);
    }
  }, [completedSessions, players, settings, showToast]);

  // ── Payments ─────────────────────────────────────────────────────────────────
  const [pendingPayments, setPendingPayments] = useState<Payment[]>([]);
  const [confirmedPayments, setConfirmedPayments] = useState<Payment[]>([]);

  const loadPendingPayments = useCallback(async () => {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setPendingPayments(data ?? []);

    const { data: confirmed } = await supabase
      .from('payments')
      .select('*')
      .eq('status', 'confirmed')
      .order('confirmed_at', { ascending: false });
    setConfirmedPayments(confirmed ?? []);
  }, []);

  // ── Player Transfers ─────────────────────────────────────────────────────────
  const [playerTransfers, setPlayerTransfers] = useState<PlayerTransfer[]>([]);

  const loadPlayerTransfers = useCallback(async () => {
    const { data } = await supabase
      .from('player_transfers')
      .select('*')
      .order('created_at', { ascending: false });
    setPlayerTransfers(data ?? []);
  }, []);

  // ── Finance ───────────────────────────────────────────────────────────────────
  const [courtPayments, setCourtPayments] = useState<CourtPayment[]>([]);
  const [miscExpenses, setMiscExpenses] = useState<MiscExpense[]>([]);
  const [financeHistory, setFinanceHistory] = useState<FinanceHistoryEntry[]>([]);

  const loadCourtPayments = useCallback(async () => {
    const { data } = await supabase
      .from('court_payments')
      .select('*')
      .order('paid_at', { ascending: false });
    setCourtPayments(data ?? []);
  }, []);

  const loadMiscExpenses = useCallback(async () => {
    setMiscExpenses([]);
  }, []);

  const loadFinanceHistory = useCallback(async () => {
    setFinanceHistory([]);
  }, []);

  const remainingFunds = React.useMemo(() => {
    return players.reduce((sum, p) => sum + p.balance, 0);
  }, [players]);

  const remainingHours = React.useMemo(() => {
    const purchased = courtPayments.reduce((sum, p: { hours_purchased?: number | string }) => sum + Number(p.hours_purchased || 0), 0);
    const used = completedSessions.reduce((sum, s) => sum + s.courts_count * (s.session_hours ?? 2), 0);
    return purchased - used;
  }, [courtPayments, completedSessions]);

  const activePlayerCount = React.useMemo(() => {
    const satGoing = Object.values(rsvpData.saturday).filter(s => s === 'going').length;
    const wedGoing = Object.values(rsvpData.wednesday).filter(s => s === 'going').length;
    const active = Math.max(satGoing, wedGoing);
    return active > 0 ? active : players.length;
  }, [rsvpData, players]);

  // ── Extra Sessions ────────────────────────────────────────────────────────────
  const [extraSessions, setExtraSessions] = useState<ExtraSession[]>([]);
  const [extraSessionRsvps, setExtraSessionRsvps] = useState<ExtraSessionRsvp[]>([]);
  const [extraSessionGuests, setExtraSessionGuests] = useState<ExtraSessionGuest[]>([]);

  const loadExtraSessions = useCallback(async () => {
    const { data } = await supabase
      .from('extra_sessions')
      .select('*')
      .order('session_date', { ascending: false });
    setExtraSessions(data ?? []);
  }, []);

  const loadExtraSessionRsvps = useCallback(async () => {
    const { data } = await supabase
      .from('extra_session_rsvps')
      .select('*')
      .order('created_at', { ascending: false });
    setExtraSessionRsvps(data ?? []);
  }, []);

  const loadExtraSessionGuests = useCallback(async () => {
    const { data } = await supabase
      .from('extra_session_guests')
      .select('*')
      .order('created_at', { ascending: false });
    setExtraSessionGuests(data ?? []);
  }, []);

  const handleSendExtraSessionEmails = useCallback(async (sessionId: number) => {
    const session = extraSessions.find(s => s.id === sessionId);
    if (!session) { showToast('Session not found'); return; }

    // Find completed_sessions row. Try the full week key first, then fall
    // back to the plain-date format used by older finalisation code.
    const extraWeekKey = `extra-${sessionId}-${session.session_date}`;
    let { data: csRows } = await supabase
      .from('completed_sessions')
      .select('id, per_person, total_cost, courts_count, session_hours, players_count, guests')
      .eq('week', extraWeekKey)
      .limit(1);

    let cs = csRows?.[0];
    if (!cs) {
      const { data: fallbackRows } = await supabase
        .from('completed_sessions')
        .select('id, per_person, total_cost, courts_count, session_hours, players_count, guests')
        .eq('session_date', session.session_date)
        .eq('is_extra', true)
        .limit(1);
      cs = fallbackRows?.[0];
    }
    if (!cs) { showToast('Session not finalised yet'); return; }

    // Get each player's actual charge
    const { data: txns } = await supabase
      .from('transactions').select('player_id, amount')
      .eq('session_id', String(cs.id)).eq('type', 'match_charge');
    const chargeMap: Record<string, number> = {};
    (txns ?? []).forEach((t: { player_id: number | null; amount: number }) => {
      if (t.player_id != null) chargeMap[String(t.player_id)] = Math.abs(t.amount);
    });

    // Get emails
    const { data: freshEmails } = await supabase.from('players').select('name, email');
    const emailMap: Record<string, string> = {};
    (freshEmails ?? []).forEach((p: { name: string; email?: string | null }) => {
      if (p.email) emailMap[p.name] = p.email;
    });

    // Get going players from extra_session_rsvps
    const { data: rsvpRows } = await supabase
      .from('extra_session_rsvps')
      .select('player_name').eq('session_id', sessionId).eq('status', 'going');
    const goingNames = (rsvpRows ?? []).map((r: { player_name: string }) => r.player_name);

    const perPerson = cs.per_person ?? 0;
    const notifyPlayers = goingNames.map(name => {
      const playerObj = players.find(p => p.name === name);
      // Count guests this player brought, so "before" adds back the full amount
      // (their own share + each guest's share), not just one share.
      const guestCount = (cs.guests ?? []).filter((g: { brought_by: string }) => g.brought_by === name).length;
      const totalDeducted = perPerson * (1 + guestCount);
      const newBalance = playerObj?.balance ?? 0;
      const oldBalance = newBalance + totalDeducted;
      return { name, oldBalance, newBalance, guestCount };
    });

    const sessionDayName = new Date(session.session_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    notifySessionComplete({
      day: sessionDayName, week: extraWeekKey,
      perPerson, totalCost: cs.total_cost ?? 0,
      courtsCount: cs.courts_count ?? 1, players: notifyPlayers,
    });

    const result = await sendSessionEmail({
      day: sessionDayName, week: extraWeekKey,
      sessionDate: session.session_date,
      sessionTime: `${session.start_time} – ${session.end_time}`,
      hoursPlayed: (cs.courts_count ?? 1) * (cs.session_hours ?? 2),
      courtsCount: cs.courts_count ?? 1,
      playersCount: cs.players_count ?? goingNames.length,
      perPerson, allPlayerNames: goingNames,
      players: notifyPlayers.map(p => ({
        ...p, email: emailMap[p.name] ?? '', guestCount: 0,
      })),
    });

    if (result.eligible === 0) {
      showToast('No players have an email saved — nothing to send.');
    } else if (result.failed === 0) {
      showToast(`Emails sent to ${result.sent} player${result.sent !== 1 ? 's' : ''} ✓`);
    } else if (result.sent === 0) {
      showToast(`Email send failed for all ${result.failed} — check Resend setup.`);
    } else {
      showToast(`Sent ${result.sent}, failed ${result.failed} — check Resend setup.`);
    }
  }, [extraSessions, players, showToast]);

  const handleToggleExtraSessionLock = useCallback(async (id: number, locked: boolean) => {
    await supabase.from('extra_sessions').update({ locked }).eq('id', id);
    await loadExtraSessions();
    showToast(locked ? 'Session locked 🔒' : 'Session unlocked 🔓');
  }, [loadExtraSessions, showToast]);

  // ── Complete Extra Session Logic ──────────────────────────────────────────────
  const completeExtraSession = useCallback(async (sessionId: number, totalCostOverride?: number) => {
    const session = extraSessions.find(s => s.id === sessionId);
    if (!session || session.auto_deducted || session.cancelled) return;

    // Guard: never finalize before the session has actually ended. Without
    // this, an admin could finalize before the session starts and deduct
    // money from balances before the session is played.
    if (!isExtraSessionEnded(session.session_date, session.end_time)) {
      showToast('Session has not ended yet — cannot finalize');
      return;
    }

    // Fetch fresh session data from DB to avoid stale state courts/times
    const { data: freshSession } = await supabase
      .from('extra_sessions')
      .select('courts, start_time, end_time')
      .eq('id', sessionId)
      .single();
    const courts = freshSession?.courts ?? session.courts ?? [];
    const startTime = freshSession?.start_time ?? session.start_time;
    const endTime = freshSession?.end_time ?? session.end_time;

    const { data: freshRsvps } = await supabase
      .from('extra_session_rsvps')
      .select('player_name, status')
      .eq('session_id', sessionId)
      .eq('status', 'going');

    const goingNames = (freshRsvps ?? []).map((r: { player_name: string }) => r.player_name);

    if (goingNames.length === 0) { showToast('No players going — cannot finalize'); return; }

    const { data: guestRows } = await supabase
      .from('extra_session_guests')
      .select('*')
      .eq('session_id', sessionId);

    const guests: GuestEntry[] = (guestRows ?? []).flatMap((row: { brought_by: string; friends: string }) => {
      try {
        const friends: { name: string; level?: string }[] = JSON.parse(row.friends);
        return friends.map(f => ({ name: f.name, brought_by: row.brought_by, level: f.level as GuestEntry['level'] }));
      } catch { return []; }
    });

    const totalPeople = goingNames.length + guests.length;
    // Calculate actual hours from session start/end time
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const hours = ((endH * 60 + endM) - (startH * 60 + startM)) / 60;

    // Safety guard: if no courts assigned, abort instead of charging $0
    if (!courts || courts.length === 0) {
      showToast('Error: No courts assigned to this session — please add courts before finalizing');
      return;
    }

    const totalCost = totalCostOverride ?? courts.length * (ratePerCourt / 2) * hours;
    const perPerson = totalPeople > 0 ? Math.round(totalCost / totalPeople * 1000) / 1000 : 0;
    const sessionDate = session.session_date;

    // Mark extra_sessions as completed
    await supabase.from('extra_sessions').update({
      auto_deducted: true,
      per_person: perPerson,
      total_cost: totalCost,
      players_count: totalPeople,
    }).eq('id', sessionId);

    // Use a unique week key per extra session so multiple sessions on the
    // same date don't overwrite each other via the onConflict: 'week,day' constraint.
    const extraWeekKey = `extra-${sessionId}-${sessionDate}`;

    // Insert into completed_sessions for court hours + history tracking
    await supabase.from('completed_sessions').upsert({
      week: extraWeekKey,
      day: 'saturday' as Day,
      session_date: sessionDate,
      players: goingNames,
      guests: guests.map(g => ({ name: g.name, brought_by: g.brought_by })),
      courts: session.courts,
      courts_count: session.courts.length,
      rate_per_court: ratePerCourt,
      total_cost: totalCost,
      players_count: totalPeople,
      per_person: perPerson,
      auto_deducted: true,
      is_extra: true,
      hours,
      session_hours: hours,
    }, { onConflict: 'week,day' });

    // Resolve player IDs
    const uniqueNames = Array.from(new Set([
      ...goingNames,
      ...guests.map(g => g.brought_by).filter(Boolean),
    ])) as string[];

    const { data: matchedPlayers } = await supabase
      .from('players')
      .select('id, name')
      .in('name', uniqueNames);

    if (!matchedPlayers?.length) return;

    const nameToId: Record<string, string> = {};
    matchedPlayers.forEach((p: { id: string; name: string }) => { nameToId[p.name] = p.id; });

    const txns: Record<string, unknown>[] = [];

    goingNames.forEach(name => {
      const playerId = nameToId[name];
      if (playerId) txns.push({
        player_id: playerId,
        type: 'match_charge',
        amount: -perPerson,
        note: `Extra Session — ${session.title} · ${sessionDate}`,
      });
    });

    guests.forEach(g => {
      if (g.brought_by) {
        const hostId = nameToId[g.brought_by];
        if (hostId) txns.push({
          player_id: hostId,
          type: 'match_charge',
          amount: -perPerson,
          note: `Guest Charge — ${g.name} hosted by ${g.brought_by} · Extra Session ${session.title} · ${sessionDate}`,
        });
      }
    });

    if (txns.length > 0) {
      await supabase.from('transactions').insert(txns);
    }

    await loadExtraSessions();
    await loadWallets();
    showToast(`"${session.title}" finalized — use "Send emails" to notify players.`);
  }, [extraSessions, extraSessionRsvps, ratePerCourt, players, loadExtraSessions, loadWallets, showToast]);

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const init = async () => {
      await Promise.all([
        loadPlayers(),
        loadSettings(),
        loadRSVPs(),
        loadAttendance(),
        loadCompletedSessions(),
        loadPendingPayments(),
        loadPlayerTransfers(),
        loadCourtPayments(),
        loadMiscExpenses(),
        loadFinanceHistory(),
        loadExtraSessions(),
        loadExtraSessionRsvps(),
        loadExtraSessionGuests(),
      ]);
      setDataReady(true);
    };
    init();
  }, [
    loadPlayers, loadSettings, loadRSVPs, loadAttendance, loadCompletedSessions,
    loadPendingPayments, loadPlayerTransfers, loadCourtPayments, loadMiscExpenses,
    loadFinanceHistory, loadExtraSessions, loadExtraSessionRsvps, loadExtraSessionGuests,
  ]);

  // ── Realtime Alignment channel ───────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('app_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => loadWallets())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => loadPlayers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rsvps' }, () => loadRSVPs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests' }, () => loadRSVPs())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => loadSettings())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completed_sessions' }, () => loadCompletedSessions())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_transfers' }, () => loadPlayerTransfers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => loadAttendance())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extra_sessions' }, () => loadExtraSessions())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extra_session_rsvps' }, () => loadExtraSessionRsvps())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extra_session_guests' }, () => loadExtraSessionGuests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => loadPendingPayments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'court_payments' }, () => loadCourtPayments())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [
    loadWallets, loadPlayers, loadRSVPs, loadSettings, loadCompletedSessions,
    loadPlayerTransfers, loadAttendance, loadExtraSessions,
    loadExtraSessionRsvps, loadExtraSessionGuests,
    loadPendingPayments, loadCourtPayments,
  ]);

  // ── Name picker trigger ───────────────────────────────────────────────────────
  useEffect(() => {
    if (dataReady && !myName) setShowNamePicker(true);
  }, [dataReady, myName]);

  // ── OneSignal registration ────────────────────────────────────────────────────
  useEffect(() => {
    if (!myName || !dataReady) return;
    const admin1 = settings.admin1 || 'Eswar';
    const admin2 = settings.admin2 || 'Arun';
    registerPlayerForNotifications(myName, [admin1, admin2]);
  }, [myName, dataReady, settings]);

  // ── Refresh tab ───────────────────────────────────────────────────────────────
  const refreshTab = useCallback(async () => {
    await Promise.all([
      loadPlayers(),
      loadRSVPs(),
      loadCompletedSessions(),
      loadAttendance(),
      loadExtraSessions(),
      loadExtraSessionRsvps(),
    ]);
  }, [loadPlayers, loadRSVPs, loadCompletedSessions, loadAttendance, loadExtraSessions, loadExtraSessionRsvps]);

  // ── currentUser Dynamic Role Resolution ───────────────────────────────────────
  const currentUser = React.useMemo(() => {
    if (!myName) return null;
    const player = players.find(p => p.name.toUpperCase() === myName.toUpperCase());
    const admin1Name = (settings.admin1 || 'Eswar').toUpperCase();
    const admin2Name = (settings.admin2 || 'Arun').toUpperCase();
    const treasurerName = (settings.treasurer || 'Treasurer').toUpperCase();
    const normalizedName = myName.toUpperCase();
    const isNamedAdmin = [admin1Name, admin2Name].includes(normalizedName);
    return {
      name: myName,
      id: player?.id,
      role: isNamedAdmin ? 'admin' : normalizedName === treasurerName ? 'treasurer' : 'player',
    };
  }, [myName, players, settings]);

  const value: AppContextValue = {
    myName, setMyName, currentUser,
    activeTab, setActiveTab,
    hiddenTabs, toggleTabVisibility,
    showNamePicker, setShowNamePicker,
    dataReady, fontSize, toast, showToast, refreshTab,
    pinVerified, verifyAdminPin, submitPin,
    isLoggedIn, loginWithPin, setupPin, resetPlayerPin, logout,
    players, setPlayers, loadPlayers, loadWallets,
    handleSettleAndArchive, handleUnarchivePlayer,
    settings, loadSettings,
    rsvpData, guestData, setGuestData, courtData, setCourtData,
    ratePerCourt, setRatePerCourt, loadRSVPs, rsvpTimestamps, rsvpHours, handleSetRsvpHours,
    attendanceData, loadAttendance,
    completedSessions, loadCompletedSessions, completeSession, completeExtraSession,
    handleUpdateSessionPlayerHours, handleUpdateSessionCourts, handleSendSessionEmails, handleSendExtraSessionEmails, handleToggleExtraSessionLock,
    pendingPayments, loadPendingPayments, confirmedPayments,
    playerTransfers, loadPlayerTransfers,
    courtPayments, miscExpenses, loadMiscExpenses,
    financeHistory, loadFinanceHistory,
    remainingFunds, remainingHours, activePlayerCount,
    extraSessions, loadExtraSessions,
    extraSessionRsvps, loadExtraSessionRsvps,
    extraSessionGuests, loadExtraSessionGuests,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}