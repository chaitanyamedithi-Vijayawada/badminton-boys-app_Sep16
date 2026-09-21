import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, UserPlus, X, Send, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { notifyTransferSubmitted } from '../lib/notifications';
import { getCutoffInfo, isVotingClosed, isSessionEndPassed, fetchServerTimeOffset, isWednesdayVotingOpen, isSaturdayVotingOpen } from '../lib/cutoff';
import type { Day, RsvpStatus, GuestLevel } from '../types';
import { notifyRsvp } from '../lib/notifications';
import ExtraSessionCard from '../components/ExtraSessionCard';
import BroadcastBanner from '../components/BroadcastBanner';
import PlayerAvatar from '../components/PlayerAvatar';
import { getNextWeekday, formatDate, getUpcomingSessionWeekKey, makeInitials, parseCourtSplit, courtSplitCourtHours } from '../lib/constants';
import { useWaitlist } from '../hooks/useWaitlist';
import { MAX_COURTS, capacityFor, courtsOpenFor } from '../lib/waitlist';

// LEVEL_LABELS is only used inside the guest modal — colocated with LEVEL_COLORS for clarity
const LEVEL_LABELS: Record<GuestLevel, string> = { E: 'Experienced', I: 'Intermediate', B: 'Beginner' };
const LEVEL_COLORS: Record<GuestLevel, string> = {
  E: 'bg-emerald-900/50 text-emerald-400 border-emerald-700/40',
  I: 'bg-violet-900/50 text-violet-400 border-violet-700/40',
  B: 'bg-amber-900/50 text-amber-400 border-amber-700/40',
};

const SAT_TIME = '7:00 AM – 9:00 AM';
const WED_DEFAULT_TIME = '6:00 PM – 8:00 PM';

// Module-level set guards against duplicate finalization across component instances

interface AttendeeItem {
  name: string;
  isGuest: boolean;
  broughtBy?: string;
  level?: GuestLevel;
}

// ---------------------------------------------------------------------------
// Utility: parse Wednesday time settings into numeric hours
// ---------------------------------------------------------------------------
function parseTueHours(settings: Record<string, string>): {
  wedTime: string;
  wedStartHour: number;
  wedEndHour: number;
} {
  let wedTime = WED_DEFAULT_TIME;
  let wedStartHour = 18;
  let wedEndHour = 20;

  try {
    const t = JSON.parse(settings.wed_time || '{}');
    wedTime = t.start && t.end ? `${t.start} – ${t.end}` : WED_DEFAULT_TIME;

    const parseHour = (str: string): number | null => {
      if (!str) return null;
      const [hStr, rest] = str.split(':');
      const isPM = rest?.toUpperCase().includes('PM');
      let h = parseInt(hStr, 10);
      if (isNaN(h)) return null;
      if (isPM && h !== 12) h += 12;
      if (!isPM && h === 12) h = 0;
      return h;
    };

    const sh = parseHour(t.start);
    const eh = parseHour(t.end);
    if (sh !== null) wedStartHour = sh;
    if (eh !== null) wedEndHour = eh;
  } catch {
    // keep defaults
  }

  return { wedTime, wedStartHour, wedEndHour };
}

// ---------------------------------------------------------------------------
// SessionCard
// Auto-finalize lives in components/RegularSessionAutoFinalizer (fires 2h after
// a session ends). SessionCard only renders UI + the manual finalize override.
// ---------------------------------------------------------------------------
function SessionCard({ day }: { day: Day }) {
  const {
    myName, rsvpData, guestData, setGuestData, courtData, settings, players,
    showToast, loadRSVPs, ratePerCourt, completedSessions, loadSettings,
    verifyAdminPin, currentUser, isLoggedIn, setShowNamePicker, completeSession,
    handleSendSessionEmails, rsvpTimestamps, rsvpHours, handleSetRsvpHours,
  } = useApp();

  const [guestModal, setGuestModal] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestLevel, setGuestLevel] = useState<GuestLevel>('I');
  // Admin "Add guest for another player" mode. When set, the modal saves the
  // guest under this host instead of the admin, auto-RSVPs the host Going if
  // they haven't already, and counts against the host's 2-guest cap.
  const [guestHost, setGuestHost] = useState<string | null>(null);

  const isCancelled = settings[`cancelled_${day}`] === 'true';
  const votingLocked = settings[`voting_locked_${day}`] === 'true';
  const courts = courtData[day] ?? [];
  const rsvps = rsvpData[day] ?? {};
  const guests = guestData[day] ?? [];

  // FIX: admin detection based on currentUser.role (currentUser is an object, not a name string)
  const isAdmin = currentUser?.role === 'admin';
  const [costOverride, setCostOverride] = useState<string>('');

  const goingPlayers = Object.entries(rsvps).filter(([, s]) => s === 'going').map(([n]) => n);
  const notComingPlayers = Object.entries(rsvps).filter(([, s]) => s === 'skip').map(([n]) => n);
  const goingCount = goingPlayers.length + guests.length;

  // Waitlist system — courts open at every 4th voter, each court accepts 5
  // (4 base + 1 extra), max 4 courts total. Everyone beyond capacity waits.
  const waitlist = useWaitlist(day);
  const acceptedCount = waitlist.accepted.length;
  const autoCourtsOpen = waitlist.courtsOpen;
  const autoCapacity = waitlist.capacity;
  const maxCapacity = capacityFor(MAX_COURTS); // 20 hard ceiling
  const myStatus = myName ? rsvps[myName] : undefined;
  // Derived state for the current player: are they in, waiting, or out?
  const myWaitState: 'accepted' | 'waitlisted' | 'none' = myName
    ? waitlist.isAccepted(myName) ? 'accepted'
    : waitlist.isWaitlisted(myName) ? 'waitlisted'
    : 'none'
    : 'none';
  const { passed: cutoffPassed, label: cutoffLabel } = getCutoffInfo(day);
  const myGuests = guests.filter(g => g.brought_by === myName);
  const myGuestCount = myGuests.length;

  // getNextWeekday always returns a future date so sessionDatePast will
  // normally be false — kept for correctness on edge-case date boundaries.
  const date = day === 'saturday' ? getNextWeekday(6) : getNextWeekday(3);
  const dateStr = formatDate(date);
  const sessionDatePast = date < new Date(new Date().setHours(0, 0, 0, 0));
  const isToday = date.toDateString() === new Date().toDateString();

  const { wedTime, wedStartHour, wedEndHour } = day === 'wednesday'
    ? parseTueHours(settings)
    : { wedTime: WED_DEFAULT_TIME, wedStartHour: 18, wedEndHour: 20 };

  const timeStr = day === 'saturday' ? SAT_TIME : wedTime;
  const votingClosed = isVotingClosed(day, 7, wedStartHour);
  const dayVotingOpen = day === 'saturday' ? isSaturdayVotingOpen() : isWednesdayVotingOpen();
  const wedVotingOpen = dayVotingOpen;

  const autoCancel = cutoffPassed && goingPlayers.length < 3;
  const sessionEnded = isSessionEndPassed(day, 9, day === 'wednesday' ? wedEndHour : 9);
  // Use the roll-forward week key so RSVPs, guests, and displayed date all
  // point to NEXT week's session immediately after this week's session ends.
  const week = getUpcomingSessionWeekKey(day);
  const alreadyCompleted = completedSessions.some(s => s.week === week && s.day === day && !s.is_extra);
  const isInReviewWindow = sessionEnded && !alreadyCompleted && !isCancelled && !autoCancel;
  const progressPercent = maxCapacity > 0 ? Math.min(100, (acceptedCount / maxCapacity) * 100) : 0;

  // Admin-set session length (hours per court) for this week+day, default 2.
  const sessionHours = Number(settings[`session_hours_${week}_${day}`]) || 2;

  // Split-court: if enabled for this day, the cost is the sum of court-hours
  // across segments (e.g. 3 courts×1h + 4×1h = 7) instead of flat courts × hours.
  const courtSplit = parseCourtSplit(settings[`court_split_${day}`]);
  // Auto-open courts drive cost estimate: only opened courts are billed, and
  // only accepted attendees pay their share. Waitlisted people don't play.
  const effectiveCourtHours = courtSplit?.enabled
    ? courtSplitCourtHours(courtSplit)
    : autoCourtsOpen * sessionHours;
  const autoTotalCost = effectiveCourtHours * (ratePerCourt / 2);

  // Live per-person estimate — divided only across accepted attendees.
  const perPersonCost = acceptedCount > 0 ? autoTotalCost / acceptedCount : 0;

  const allAttendees: AttendeeItem[] = [
    ...goingPlayers
      .map(n => ({ name: n, isGuest: false }))
      .sort((a, b) => {
        const ta = rsvpTimestamps[day]?.[a.name];
        const tb = rsvpTimestamps[day]?.[b.name];
        if (!ta && !tb) return 0;
        if (!ta) return 1;
        if (!tb) return -1;
        return new Date(ta).getTime() - new Date(tb).getTime();
      }),
    ...guests.map(g => ({
      name: g.name,
      isGuest: true,
      broughtBy: g.brought_by,
      level: g.level as GuestLevel | undefined,
    })),
  ];

  // Split for rendering: accepted attendees go in the main "Attendance" list,
  // waitlisted attendees go in a separate "Waitlist" section below.
  const acceptedNameSet = new Set(waitlist.accepted.map(a => `${a.isGuest ? 'g:' : 'p:'}${a.name}`));
  const acceptedAttendees = allAttendees.filter(a =>
    acceptedNameSet.has(`${a.isGuest ? 'g:' : 'p:'}${a.name}`)
  );
  const waitlistedAttendees = allAttendees.filter(a =>
    !acceptedNameSet.has(`${a.isGuest ? 'g:' : 'p:'}${a.name}`)
  );

  const formatVotedAt = (ts: string) => {
    // Always render in Pacific time — the club's home timezone — so every
    // player (any device, any location) sees the same "you voted at 7pm".
    // Otherwise a viewer in India would see the vote 12.5 hrs later than
    // it happened locally, which is confusing.
    const d = new Date(ts);
    const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Vancouver' });
    const time = d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Vancouver',
    });
    return `${day} ${time}`;
  };

  const notGoingNames = players
    .filter(p => !p.archived && !goingPlayers.includes(p.name))
    .map(p => p.name).sort();

  // -------------------------------------------------------------------------
  // RSVP
  // -------------------------------------------------------------------------
  const targetDayRsvps = rsvpData[day];

  const handleRsvp = useCallback(async (status: RsvpStatus) => {
    if (!myName) { showToast('Please select your name first'); return; }
    if (cutoffPassed && status === 'skip') { showToast('Cannot cancel after cutoff'); return; }
    const week = getUpcomingSessionWeekKey(day);
    const { error: rsvpErr } = await supabase.from('rsvps').upsert(
      { week, day, player_name: myName, status, voted_at: new Date().toISOString() },
      { onConflict: 'week,day,player_name' }
    );
    if (rsvpErr) {
      showToast('Failed to save — please try again');
      return;
    }
    if (status === 'going') {
      const { error: attErr } = await supabase.from('attendance').upsert(
        { week, day, player_name: myName },
        { onConflict: 'week,day,player_name' }
      );
      if (attErr) { showToast('Vote saved but attendance sync failed — try again'); return; }
    } else if (status === 'skip') {
      await supabase.from('attendance').delete()
        .eq('week', week).eq('day', day).eq('player_name', myName);
    }
    await loadRSVPs();

    // Waitlist-aware toast: if a "going" vote lands them beyond capacity,
    // let them know they're on the waitlist. This uses the projected count
    // (voters after this vote) to guess status without waiting for React
    // to re-render — server-truth arrives on the next render anyway.
    if (status === 'going') {
      const currentGuestCount = (guestData[day] ?? []).length;
      const currentGoingBefore = Object.values(targetDayRsvps ?? {}).filter(v => v === 'going').length;
      const wasAlreadyGoing = (targetDayRsvps ?? {})[myName] === 'going';
      const projectedTotal = currentGoingBefore + currentGuestCount + (wasAlreadyGoing ? 0 : 1);
      const projectedCapacity = capacityFor(courtsOpenFor(projectedTotal));
      if (projectedTotal > projectedCapacity) {
        showToast(`You're on the waitlist (#${projectedTotal - projectedCapacity})`);
      } else {
        showToast("You're in!");
      }
    } else {
      showToast('Marked as not coming');
    }

    const currentRsvps = targetDayRsvps ?? {};
    const nextRsvps = { ...currentRsvps, [myName]: status };
    const nextGoingPlayers = Object.values(nextRsvps).filter(v => v === 'going').length;
    const guestsCount = (guestData[day] ?? []).length;
    notifyRsvp(myName, day, status, nextGoingPlayers + guestsCount);
  }, [myName, day, cutoffPassed, showToast, loadRSVPs, targetDayRsvps, guestData]);

  // -------------------------------------------------------------------------
  // Guest management
  // -------------------------------------------------------------------------
  const handleAddGuest = useCallback(() => {
    if (!myName || myGuestCount >= 2) return;
    setGuestHost(null);              // self mode
    setGuestName('');
    setGuestLevel('I');
    setGuestModal(true);
  }, [myName, myGuestCount]);

  // Admin-only: open the guest modal in "on behalf of <player>" mode. The host
  // picker inside the modal lets admin choose which player the guest belongs to.
  const handleAddGuestForOther = useCallback(() => {
    if (!myName) return;
    setGuestHost('');                // marker for on-behalf mode, host TBD
    setGuestName('');
    setGuestLevel('I');
    setGuestModal(true);
  }, [myName]);

  const handleConfirmAddGuest = useCallback(async () => {
    if (!myName) return;

    // On-behalf mode (admin): host is the picked player, not the admin.
    const onBehalf = guestHost !== null;
    const host = onBehalf ? guestHost!.trim() : myName;
    if (onBehalf && !host) {
      showToast('Pick a player to add the guest for');
      return;
    }

    // Enforce the per-host 2-guest cap on both flows.
    const hostExistingGuests = (guestData[day] ?? []).filter(g => g.brought_by === host);
    if (hostExistingGuests.length >= 2) {
      showToast(`${host} already has ${hostExistingGuests.length} guests (max 2)`);
      return;
    }

    const name = guestName.trim() || `${host}'s guest`;
    const newGuest = { name, level: guestLevel };
    const updatedHostGuests = [
      ...hostExistingGuests.map(g => ({ name: g.name, level: g.level })),
      newGuest,
    ];
    setGuestModal(false);

    setGuestData(prev => ({
      ...prev,
      [day]: [
        ...(prev[day] ?? []).filter(g => g.brought_by !== host),
        ...updatedHostGuests.map(f => ({ ...f, brought_by: host })),
      ],
    }));

    const week = getUpcomingSessionWeekKey(day);
    await supabase.from('guests').upsert(
      { week, day, brought_by: host, friends: JSON.stringify(updatedHostGuests) },
      { onConflict: 'week,day,brought_by' }
    );

    // On-behalf mode: auto-RSVP the host as Going if they aren't already.
    // (Admin picked this player as host → they're showing up, charge them
    // for both their seat and the guest, per the agreed rule.)
    if (onBehalf) {
      const hostRsvpStatus = targetDayRsvps[host];
      if (hostRsvpStatus !== 'going' && hostRsvpStatus !== 'skip') {
        await supabase.from('rsvps').upsert(
          { week, day, player_name: host, status: 'going', voted_at: new Date().toISOString() },
          { onConflict: 'week,day,player_name' }
        );
        await supabase.from('attendance').upsert(
          { week, day, player_name: host },
          { onConflict: 'week,day,player_name' }
        );
        showToast(`Added guest for ${host} · auto-RSVP'd them Going`);
      } else {
        showToast(`Added guest for ${host}`);
      }
    }

    await loadRSVPs();
  }, [myName, guestHost, guestName, guestLevel, guestData, day, targetDayRsvps, setGuestData, loadRSVPs, showToast]);

  const handleRemoveGuest = useCallback(async (index: number) => {
    if (!myName) return;
    if (cutoffPassed) { showToast('Cannot remove guests after cutoff'); return; }
    const updated = myGuests.filter((_, i) => i !== index);
    const week = getUpcomingSessionWeekKey(day);

    setGuestData(prev => ({
      ...prev,
      [day]: [
        ...(prev[day] ?? []).filter(g => g.brought_by !== myName),
        ...updated.map(g => ({ name: g.name, level: g.level, brought_by: myName })),
      ],
    }));

    if (updated.length === 0) {
      await supabase.from('guests').delete()
        .eq('week', week).eq('day', day).eq('brought_by', myName);
    } else {
      await supabase.from('guests').upsert(
        { week, day, brought_by: myName, friends: JSON.stringify(updated.map(g => ({ name: g.name, level: g.level }))) },
        { onConflict: 'week,day,brought_by' }
      );
    }
    await loadRSVPs();
  }, [myName, day, myGuests, cutoffPassed, showToast, setGuestData, loadRSVPs]);

  // -------------------------------------------------------------------------
  // Admin remove — FIX: buttons rendered only for admins, not all users
  // -------------------------------------------------------------------------
  const handleAdminRemovePlayer = useCallback(async (playerName: string) => {
    if (!verifyAdminPin()) return;
    if (!window.confirm(`Remove ${playerName} from ${day} session?`)) return;
    const week = getUpcomingSessionWeekKey(day);
    await supabase.from('rsvps').delete()
      .eq('week', week).eq('day', day).eq('player_name', playerName);
    await supabase.from('attendance').delete()
      .eq('week', week).eq('day', day).eq('player_name', playerName);
    await loadRSVPs();
    showToast(`${playerName} removed ✓`);
  }, [day, showToast, loadRSVPs, verifyAdminPin]);

  const handleAdminAddPlayer = useCallback(async (playerName: string) => {
    const week = getUpcomingSessionWeekKey(day);
    await supabase.from('rsvps').upsert(
      { week, day, player_name: playerName, status: 'going', voted_at: new Date().toISOString() },
      { onConflict: 'week,day,player_name' }
    );
    await supabase.from('attendance').upsert(
      { week, day, player_name: playerName },
      { onConflict: 'week,day,player_name' }
    );
    await loadRSVPs();
    showToast(`${playerName} added ✓`);
  }, [day, showToast, loadRSVPs]);

  const handleAdminRemoveGuest = useCallback(async (broughtBy: string, index: number) => {
    if (!verifyAdminPin()) return;
    if (!window.confirm(`Remove guest of ${broughtBy}?`)) return;
    const week = getUpcomingSessionWeekKey(day);
    const hostGuests = guests.filter(g => g.brought_by === broughtBy);
    const updated = hostGuests.filter((_, i) => i !== index);
    if (updated.length === 0) {
      await supabase.from('guests').delete()
        .eq('week', week).eq('day', day).eq('brought_by', broughtBy);
    } else {
      await supabase.from('guests').upsert(
        { week, day, brought_by: broughtBy, friends: JSON.stringify(updated.map(g => ({ name: g.name, level: g.level }))) },
        { onConflict: 'week,day,brought_by' }
      );
    }
    await loadRSVPs();
    showToast('Guest removed ✓');
  }, [day, guests, showToast, loadRSVPs, verifyAdminPin]);

  // -------------------------------------------------------------------------
  // Status badge
  // -------------------------------------------------------------------------
  const statusColor = isCancelled || autoCancel
    ? 'bg-red-900/40 text-red-400'
    : alreadyCompleted
    ? 'bg-emerald-900/40 text-emerald-400'
    : sessionDatePast
    ? 'bg-slate-700/60 text-slate-500'
    : isToday && sessionEnded
    ? 'bg-slate-700/60 text-slate-500'
    : isToday && !sessionEnded
    ? 'bg-green-900/40 text-green-400'
    : !wedVotingOpen
    ? 'bg-slate-700/60 text-slate-400'
    : votingLocked
    ? 'bg-amber-900/40 text-amber-400'
    : cutoffPassed
    ? 'bg-amber-900/40 text-amber-400'
    : 'bg-violet-900/40 text-violet-400';

  const statusLabel = isCancelled || autoCancel
    ? 'Cancelled'
    : alreadyCompleted
    ? 'Completed'
    : sessionDatePast
    ? 'Past'
    : isToday && sessionEnded
    ? 'Ended'
    : isToday && !sessionEnded
    ? 'Ongoing'
    : !wedVotingOpen
    ? 'Opens Sat'
    : votingLocked
    ? 'Locked'
    : cutoffPassed
    ? 'Upcoming'
    : 'Open';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className={`neon-card mb-3 ${votingLocked ? '!border-amber-600/40' : ''}`}>

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-base font-semibold text-slate-100 capitalize">{day}</div>
          <div className="text-xs text-slate-400">{dateStr}</div>
          <div className="text-xs text-slate-400">{timeStr}</div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* Review window — session ended, admin must manually finalize */}
      {isInReviewWindow && (
        <div className="rounded-xl px-4 py-3 mb-3 border border-violet-400/30"
          style={{ background: 'linear-gradient(135deg, rgba(124,92,255,0.13), rgba(196,77,219,0.08))' }}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-violet-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-violet-300">Session ended — review before finalizing</span>
          </div>
          <div className="text-xs text-slate-400 mb-3">
            Check attendance is complete.
            <span className="text-violet-300 font-medium"> {goingCount} player{goingCount !== 1 ? 's' : ''} going.</span>
          </div>
          {isAdmin && (
            <>
              {/* Optional total cost override — for split-court sessions */}
              <div className="mb-3">
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wide block mb-1">
                  Total cost override <span className="text-slate-600 normal-case">(leave blank to auto-calculate)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={`Auto: $${autoTotalCost.toFixed(2)}`}
                    value={costOverride}
                    onChange={e => setCostOverride(e.target.value)}
                    className="flex-1 bg-white/[0.06] border border-slate-600/40 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              </div>
              <button
                onClick={async () => {
                  if (!verifyAdminPin()) return;
                  const override = costOverride.trim() !== '' ? parseFloat(costOverride) : undefined;
                  await completeSession(day, override);
                  setCostOverride('');
                }}
                className="w-full py-2 rounded-xl btn-gradient hover:brightness-110 text-white text-xs font-semibold transition-all"
              >
                ✓ Finalize session & apply charges
              </button>
            </>
          )}
        </div>
      )}

      {/* Completed summary */}
      {alreadyCompleted && (() => {
        const completedSession = completedSessions.find(s => s.week === week && s.day === day && !s.is_extra);
        const myPlayer = players.find(p => p.name === myName);
        const wasGoing = completedSession?.players?.includes(myName ?? '');

        // FIX: only use the stored per_person value; never fall back to the
        //      live estimate which may reflect a different player count.
        const pp = completedSession?.per_person ?? null;

        const myGuestsInSession = completedSession?.guests?.filter(g => g.brought_by === myName) ?? [];
        const totalDeducted = pp !== null ? pp * (1 + myGuestsInSession.length) : null;
        const newBal = myPlayer?.balance ?? 0;
        const oldBal = wasGoing && totalDeducted !== null ? newBal + totalDeducted : null;

        return (
          <div
            className="relative overflow-hidden rounded-2xl mb-3 border border-violet-400/20"
            style={{ background: 'linear-gradient(135deg, rgba(124,92,255,0.18), rgba(196,77,219,0.10) 55%, rgba(255,111,145,0.10))' }}
          >
            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
              <span className="text-base leading-none">🏸</span>
              <span className="text-xs font-bold tracking-[0.15em] uppercase bg-gradient-to-r from-violet-300 to-[#ff9ab0] bg-clip-text text-transparent">
                Session wrapped
              </span>
              <CheckCircle size={13} className="text-emerald-400 flex-shrink-0 ml-auto" />
            </div>
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-slate-300 mb-1">
                <span>{completedSession?.players_count ?? goingCount} players</span>
                <span className="text-slate-600">·</span>
                <span>
                  {completedSession?.courts_count ?? courts.length} court
                  {(completedSession?.courts_count ?? courts.length) !== 1 ? 's' : ''}
                </span>
                <span className="text-slate-600">·</span>
                {pp !== null
                  ? <span className="text-violet-300 font-medium">${pp.toFixed(2)}/person</span>
                  : <span className="text-slate-500">—/person</span>
                }
              </div>
              {myName && wasGoing && oldBal !== null && totalDeducted !== null && myPlayer && (
                <div className="mt-2 pt-2 border-t border-white/10">
                  <div className="text-xs text-slate-400 mb-1.5">Your balance change</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-300">${oldBal.toFixed(2)}</span>
                    <span className="text-xs text-slate-600">→</span>
                    <span className="text-xs text-red-400 font-medium">−${totalDeducted.toFixed(2)}</span>
                    {myGuestsInSession.length > 0 && (
                      <span className="text-xs text-slate-500">(+{myGuestsInSession.length} guest)</span>
                    )}
                    <span className="text-xs text-slate-600">→</span>
                    <span className={`text-sm font-bold ${newBal < 0 ? 'text-red-400' : newBal < 15 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      ${newBal.toFixed(2)}
                    </span>
                  </div>
                  <button
                    onClick={async () => {
                      const txt = `🏸 Badminton Boys — ${day === 'saturday' ? 'Saturday' : 'Wednesday'} wrapped!\n${completedSession?.players_count ?? goingCount} players · ${completedSession?.courts_count ?? courts.length} courts\nMy share: −$${totalDeducted.toFixed(2)} · Balance: $${newBal.toFixed(2)}`;
                      try {
                        if (navigator.share) await navigator.share({ title: 'Session wrapped', text: txt });
                        else { await navigator.clipboard.writeText(txt); showToast('Recap copied'); }
                      } catch { /* share cancelled */ }
                    }}
                    className="mt-3 w-full py-2 rounded-xl btn-gradient hover:brightness-110 text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                  >
                    <Send size={12} /> Share recap
                  </button>
                </div>
              )}
              {myName && !wasGoing && (
                <div className="text-xs text-slate-500 mt-1">You were not in this session</div>
              )}
              {isAdmin && (
                <button
                  onClick={async () => {
                    await handleSendSessionEmails(day);
                  }}
                  className="mt-3 w-full py-2 rounded-xl bg-white/[0.06] border border-violet-400/20 hover:border-violet-400/40 text-violet-300 text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                >
                  📧 Send session emails
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Cutoff label */}
      {!isCancelled && !autoCancel && !alreadyCompleted && (
        <div className={`rounded-lg px-3 py-2 mb-3 text-xs flex items-center gap-1.5 ${
          cutoffPassed
            ? 'bg-amber-900/20 border border-amber-700/30 text-amber-400'
            : 'bg-violet-900/20 border border-violet-700/30 text-violet-400'
        }`}>
          <Clock size={12} className="flex-shrink-0" />
          <span>{cutoffLabel}</span>
        </div>
      )}

      {/* Cancelled notice */}
      {(isCancelled || autoCancel) && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2 mb-3 text-xs text-red-400">
          {isCancelled ? 'Session cancelled by admin' : 'Session auto-cancelled (less than 3 players)'}
        </div>
      )}

      {/* Courts — auto-opened by voter count under the waitlist system.
          Shows how many courts are currently active for this session. */}
      {autoCourtsOpen > 0 && (
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {Array.from({ length: autoCourtsOpen }, (_, i) => i + 1).map(c => (
            <span key={c} className="bg-violet-900/30 text-violet-400 text-xs font-semibold px-2 py-1 rounded-full border border-violet-700/30">
              Court {c}
            </span>
          ))}
        </div>
      )}

      {/* Admin: session length (hours per court). Default 2. Applies to this
          session only and is read when the session is finalized. */}
      {isAdmin && !isCancelled && !alreadyCompleted && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-slate-400">Session length:</span>
          <input
            type="number"
            min="0.5"
            max="6"
            step="0.5"
            defaultValue={sessionHours}
            onBlur={async (e) => {
              const v = Math.max(0.5, Math.min(6, Number(e.target.value) || 2));
              e.target.value = String(v);
              await supabase.from('settings').upsert(
                { key: `session_hours_${week}_${day}`, value: String(v) },
                { onConflict: 'key' }
              );
              await loadSettings();
              showToast(`Session length set to ${v} hr${v === 1 ? '' : 's'}`);
            }}
            className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-violet-300 text-center"
          />
          <span className="text-slate-500">hrs/court (default 2)</span>
        </div>
      )}

      {/* Progress bar */}
      <div className="mb-3" style={{ overflow: 'visible', position: 'relative' }}>
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>{goingCount} going</span>
          <span>Max {maxCapacity}</span>
        </div>
        <div className="progress-bar-wrap" style={{ position: 'relative', overflow: 'visible' }}>
          <div
            className="progress-fill"
            style={{
              width: `${progressPercent}%`,
              transition: 'width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              position: 'relative',
            }}
          />
          {goingCount > 0 && goingCount < maxCapacity && (
            <span style={{
              position: 'absolute',
              left: `${Math.min(96, progressPercent)}%`,
              top: '-10px',
              fontSize: progressPercent >= 75 ? '20px' : '16px',
              animation: 'runnerBounce 0.5s ease-in-out infinite',
              pointerEvents: 'none',
              lineHeight: 1,
              zIndex: 10,
              filter: 'drop-shadow(0 0 4px rgba(124,92,255,0.5))',
              transform: 'scaleX(-1)',
            }}>
              🏸
            </span>
          )}
        </div>
      </div>

      {/* Estimated cost */}
      {perPersonCost > 0 && !alreadyCompleted && (
        <div className="text-xs text-slate-400 mb-3">
          Est. cost: <span className="text-violet-400 font-semibold">${perPersonCost.toFixed(2)}/person</span>
        </div>
      )}

      {/* RSVP controls */}
      {!isCancelled && !autoCancel && !alreadyCompleted && (
        <>
          {!dayVotingOpen ? (
            <div className="rounded-xl px-4 py-3 mb-3 flex items-center gap-2 border bg-violet-400/8 border-violet-400/30">
              <Clock size={16} className="flex-shrink-0 text-violet-400" />
              <div>
                <div className="text-sm font-semibold text-violet-400">
                  {day === 'saturday'
                    ? 'Voting opens Sunday 4:00 AM'
                    : 'Voting opens Thursday 4:00 AM'}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {day === 'saturday'
                    ? "Saturday RSVP resumes the morning after this week's session"
                    : "Wednesday RSVP resumes the morning after this week's session"}
                </div>
              </div>
            </div>
          ) : !isLoggedIn ? (
            <button
              onClick={() => setShowNamePicker(true)}
              className="w-full mb-3 py-3 px-4 bg-violet-400/6 border border-violet-400/20 hover:border-violet-400/50 rounded-xl text-violet-400 text-sm font-semibold transition-all text-center"
            >
              🔒 Login to vote
            </button>
          ) : ((votingLocked || votingClosed) && !isAdmin) ? (
            <div className={`rounded-xl px-4 py-3 mb-3 flex items-center gap-2 border ${
              votingClosed
                ? 'bg-red-500/8 border-red-500/30'
                : 'bg-amber-400/8 border-amber-400/30'
            }`}>
              <AlertCircle
                size={16}
                className={`flex-shrink-0 ${votingClosed ? 'text-red-400' : 'text-amber-400'}`}
              />
              <div>
                <div className={`text-sm font-semibold ${votingClosed ? 'text-red-400' : 'text-amber-400'}`}>
                  {votingClosed ? 'Voting closed — 24h before session' : 'Voting locked by admin'}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {votingClosed
                    ? 'RSVP is no longer available for this session'
                    : 'Admin has disabled voting for this session'}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Admin-only override banner shown when admin is bypassing a lock/close */}
              {(votingLocked || votingClosed) && isAdmin && (
                <div className="rounded-xl px-3 py-2 mb-2 flex items-center gap-2 bg-amber-400/8 border border-amber-400/30">
                  <AlertCircle size={14} className="flex-shrink-0 text-amber-400" />
                  <span className="text-xs text-amber-300">
                    {votingClosed ? 'Voting closed' : 'Voting locked'} · admin override
                  </span>
                </div>
              )}
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => handleRsvp('going')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                    myStatus === 'going'
                      ? 'bg-violet-500 border-violet-500 text-white shadow-[0_0_12px_rgba(124,92,255,0.3)]'
                      : 'bg-transparent border-slate-700 text-slate-300 hover:border-violet-500/50'
                  }`}
                >
                  Going
                </button>
                {!cutoffPassed && (
                  <button
                    onClick={() => handleRsvp('skip')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                      myStatus === 'skip'
                        ? 'bg-red-500/80 border-red-500 text-white shadow-[0_0_12px_rgba(124,92,255,0.3)]'
                        : 'bg-transparent border-slate-700 text-slate-300 hover:border-red-500/50'
                    }`}
                  >
                    Not coming
                  </button>
                )}
              </div>
              {/* Personal status — accepted or waitlisted */}
              {myStatus === 'going' && myWaitState === 'waitlisted' && (
                <div className="flex items-center gap-1.5 mb-3 text-xs text-amber-400 bg-amber-400/8 border border-amber-400/25 rounded-lg px-3 py-2">
                  <Clock size={12} className="flex-shrink-0" />
                  <span>You're on the waitlist. If someone drops or a new court opens, you'll be moved in automatically.</span>
                </div>
              )}
              {myStatus === 'going' && myWaitState === 'accepted' && (
                <div className="flex items-center gap-1.5 mb-3 text-xs text-emerald-400 bg-emerald-400/8 border border-emerald-400/25 rounded-lg px-3 py-2">
                  <CheckCircle size={12} className="flex-shrink-0" />
                  <span>You're in for this session.</span>
                </div>
              )}
              {cutoffPassed && (
                <div className="flex items-start gap-1.5 mb-3 text-xs text-amber-400/80">
                  <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                  <span>You can still join, but you cannot cancel after cutoff.</span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Admin-only: Add guest on behalf of another player. Independent of the
          admin's own RSVP status, so admins can add walk-ins for anyone. */}
      {isAdmin && !isCancelled && !autoCancel && !alreadyCompleted && wedVotingOpen && (
        <div className="bg-amber-900/15 border border-amber-700/30 rounded-xl px-4 py-3 mb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserPlus size={14} className="text-amber-400" />
              <span className="text-xs text-amber-300">Add guest for another player <span className="text-amber-500/70">· admin</span></span>
            </div>
            <button
              onClick={handleAddGuestForOther}
              className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <UserPlus size={12} /> Add for player
            </button>
          </div>
        </div>
      )}

      {/* Guest panel — shown for both 'going' and 'skip' (host pays either way).
          Admin override: when voting is locked or closed, normal players can't
          add guests, but admins still can (e.g. someone shows up day-of). */}
      {!isCancelled && !autoCancel && !alreadyCompleted &&
        (!votingLocked || isAdmin) && (!votingClosed || isAdmin) &&
        wedVotingOpen &&
        isLoggedIn && (myStatus === 'going' || myStatus === 'skip') && (
        <div className="bg-slate-800/60 rounded-xl px-4 py-3 mb-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <UserPlus size={14} className="text-slate-400" />
              <span className="text-xs text-slate-400">
                Guests ({myGuestCount}/2)
                {myStatus === 'skip' && (
                  <span className="text-amber-400 ml-1">— you'll be charged for your guests</span>
                )}
                {(votingLocked || votingClosed) && isAdmin && (
                  <span className="text-amber-400 ml-1">· admin override</span>
                )}
              </span>
            </div>
            {myGuestCount < 2 && (
              <button
                onClick={handleAddGuest}
                className="flex items-center gap-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <UserPlus size={12} /> Add guest
              </button>
            )}
          </div>
          {myGuests.map((g, i) => (
            <div key={i} className="flex items-center gap-2 mt-1.5">
              <div className="w-6 h-6 rounded-full bg-pink-900/40 text-pink-400 flex items-center justify-center text-xs font-semibold flex-shrink-0">G</div>
              <span className="text-sm text-slate-200 flex-1">{g.name}</span>
              {g.level && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${LEVEL_COLORS[g.level as GuestLevel]}`}>
                  {g.level}
                </span>
              )}
              {!cutoffPassed && (
                <button
                  onClick={() => handleRemoveGuest(i)}
                  className="w-6 h-6 rounded-full bg-slate-700 hover:bg-red-900/60 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Attendance list */}
      {(allAttendees.length > 0 || notComingPlayers.length > 0) && (
        <div>
          {acceptedAttendees.length > 0 && (
            <>
              <div className="text-xs font-medium text-slate-500 mb-2 flex items-center justify-between">
                <span>Accepted ({acceptedAttendees.length}/{autoCapacity})</span>
                <span className="text-[10px] text-violet-400/70">
                  {autoCourtsOpen} court{autoCourtsOpen !== 1 ? 's' : ''} open
                </span>
              </div>
              <div className="flex flex-col gap-1.5 mb-3">
                {acceptedAttendees.map((a, i) => {
                  const player = players.find(p => p.name === a.name);
                  const initials = a.isGuest ? 'G' : makeInitials(a.name);
                  const bg = a.isGuest ? 'rgba(255,111,145,0.18)' : (player?.color.bg ?? 'rgba(100,100,100,0.2)');
                  const fg = a.isGuest ? '#ff6f91' : (player?.color.fg ?? '#aaa');
                  const guestIndex = a.isGuest && a.broughtBy
                    ? guests.filter(g => g.brought_by === a.broughtBy).findIndex(g => g.name === a.name)
                    : -1;

                  const is1h = !a.isGuest && (rsvpHours[day]?.[a.name] ?? 2) === 1;
                  return (
                    <div key={i} className={`flex items-center gap-2 px-1.5 py-0.5 rounded-lg transition-all ${is1h ? 'bg-amber-900/15 border border-amber-700/20' : ''}`}>
                      <span className="text-xs w-4 text-white">{i + 1}.</span>
                      {a.isGuest ? (
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                          style={{ background: bg, color: fg }}
                        >
                          {initials}
                        </div>
                      ) : (
                        <PlayerAvatar player={player} size={28} />
                      )}
                      <span className="text-sm text-slate-300 flex-1 uppercase">{a.name}</span>
                      {!a.isGuest && rsvpTimestamps[day]?.[a.name] && (
                        <span className="text-[10px] text-slate-500">
                          {formatVotedAt(rsvpTimestamps[day][a.name])}
                        </span>
                      )}
                      {a.isGuest && a.broughtBy && rsvpTimestamps[day]?.[a.broughtBy] && (
                        <span className="text-[10px] text-slate-500">
                          {formatVotedAt(rsvpTimestamps[day][a.broughtBy])}
                        </span>
                      )}
                      {!a.isGuest && !alreadyCompleted && (
                        <button
                          onClick={async () => {
                            if (cutoffPassed && a.name !== myName && !isAdmin) return;
                            if (a.name !== myName && !isAdmin) return;
                            const current = rsvpHours[day]?.[a.name] ?? 2;
                            await handleSetRsvpHours(day, a.name, current === 2 ? 1 : 2);
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-all ${
                            (rsvpHours[day]?.[a.name] ?? 2) === 1
                              ? 'bg-amber-900/40 text-amber-400 border-amber-700/30'
                              : 'bg-white/[0.03] text-slate-600 border-slate-700/20'
                          }`}
                        >
                          {(rsvpHours[day]?.[a.name] ?? 2) === 1 ? '1h' : '2h'}
                        </button>
                      )}
                      {a.isGuest && a.broughtBy && (
                        <span className="text-xs text-slate-500">
                          by <span className="uppercase">{a.broughtBy}</span>
                        </span>
                      )}
                      {a.isGuest && a.level && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${LEVEL_COLORS[a.level]}`}>
                          {a.level}
                        </span>
                      )}
                      {/* FIX: admin remove buttons only visible to admins */}
                      {isAdmin && !a.isGuest && (
                        <button
                          onClick={() => handleAdminRemovePlayer(a.name)}
                          className="w-6 h-6 rounded-full bg-red-900/20 hover:bg-red-900/50 text-red-400/50 hover:text-red-400 flex items-center justify-center transition-colors"
                        >
                          <X size={10} />
                        </button>
                      )}
                      {isAdmin && a.isGuest && a.broughtBy && guestIndex >= 0 && (
                        <button
                          onClick={() => handleAdminRemoveGuest(a.broughtBy!, guestIndex)}
                          className="w-6 h-6 rounded-full bg-red-900/20 hover:bg-red-900/50 text-red-400/50 hover:text-red-400 flex items-center justify-center transition-colors"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Waitlist section — attendees beyond the current court capacity.
              They keep their spot in line; if someone accepted drops or a new
              court opens (voter #4/8/12/16), the top of the waitlist promotes
              up automatically. */}
          {waitlistedAttendees.length > 0 && (
            <div className="mt-1 mb-3">
              <div className="text-xs font-medium text-amber-400/80 mb-2 flex items-center justify-between">
                <span>Waitlist ({waitlistedAttendees.length})</span>
                <span className="text-[10px] text-slate-500">
                  {autoCourtsOpen < MAX_COURTS
                    ? `${(autoCourtsOpen + 1) * 4 - waitlist.totalVoters} more to open court ${autoCourtsOpen + 1}`
                    : `Max ${MAX_COURTS} courts reached`}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {waitlistedAttendees.map((a, i) => {
                  const player = players.find(p => p.name === a.name);
                  const initials = a.isGuest ? 'G' : makeInitials(a.name);
                  const bg = a.isGuest ? 'rgba(255,111,145,0.10)' : (player?.color.bg ?? 'rgba(100,100,100,0.12)');
                  const fg = a.isGuest ? '#ff6f91' : (player?.color.fg ?? '#aaa');
                  return (
                    <div
                      key={`w-${a.isGuest ? 'g' : 'p'}-${a.name}`}
                      className="flex items-center gap-2 opacity-70"
                    >
                      <span className="text-xs w-4 text-amber-400/60">{i + 1}.</span>
                      {a.isGuest ? (
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                          style={{ background: bg, color: fg }}
                        >
                          {initials}
                        </div>
                      ) : (
                        <PlayerAvatar player={player} size={28} />
                      )}
                      <div className="flex-1 flex items-center gap-1.5 min-w-0">
                        <span className="text-sm text-slate-300 truncate">{a.name}</span>
                        {a.isGuest && a.broughtBy && (
                          <span className="text-[10px] text-slate-500 truncate">
                            (guest of {a.broughtBy})
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-amber-400/70 uppercase tracking-wide">Waiting</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Admin: add player to session */}
          {isAdmin && !alreadyCompleted && !isCancelled && notGoingNames.length > 0 && (
            <div className="mt-2 mb-2">
              <select
                defaultValue=""
                onChange={async e => {
                  const name = e.target.value;
                  if (!name) return;
                  e.target.value = '';
                  await handleAdminAddPlayer(name);
                }}
                className="w-full bg-white/[0.04] border border-violet-400/20 rounded-xl px-3 py-2 text-xs text-slate-400 focus:outline-none focus:border-violet-400/40"
              >
                <option value="">+ Add player to session...</option>
                {notGoingNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}

          {notComingPlayers.length > 0 && (
            <div className="mt-1">
              <div className="text-xs font-medium text-red-400/70 mb-2">
                Not coming ({notComingPlayers.length})
              </div>
              <div className="flex flex-col gap-1.5">
                {notComingPlayers.map((name, i) => {
                  const player = players.find(p => p.name === name);
                  return (
                    <div key={name} className="flex items-center gap-2 opacity-50">
                      <span className="text-xs w-4 text-slate-600">{i + 1}.</span>
                      <PlayerAvatar player={player} size={28} />
                      <span className="text-sm text-slate-500 flex-1 line-through uppercase">{name}</span>
                      {/* FIX: admin remove buttons only visible to admins */}
                      {isAdmin && (
                        <button
                          onClick={() => handleAdminRemovePlayer(name)}
                          className="w-6 h-6 rounded-full bg-red-900/20 hover:bg-red-900/50 text-red-400/50 hover:text-red-400 flex items-center justify-center transition-colors"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Guest modal */}
      {guestModal && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center px-5"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-xs rounded-2xl overflow-hidden border border-slate-700"
            style={{ background: 'rgba(15,20,30,0.98)' }}
          >
            <div className="px-4 pt-4 pb-3 border-b border-slate-700/50 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-100">
                {guestHost !== null ? 'Add Guest for Player' : 'Add Guest'}
              </span>
              <button
                onClick={() => setGuestModal(false)}
                className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              {guestHost !== null && (
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Host (the player this guest belongs to)</label>
                  <select
                    value={guestHost}
                    onChange={e => setGuestHost(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
                  >
                    <option value="">— Pick a player —</option>
                    {players
                      .filter(p => !p.archived && p.name !== myName)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(p => {
                        const hostGuests = (guestData[day] ?? []).filter(g => g.brought_by === p.name);
                        const atCap = hostGuests.length >= 2;
                        const status = targetDayRsvps[p.name];
                        const tag = atCap ? ' (max 2 guests)' : status === 'going' ? ' (going)' : status === 'skip' ? ' (skip)' : ' (not RSVP\'d)';
                        return (
                          <option key={p.name} value={p.name} disabled={atCap}>
                            {p.name}{tag}
                          </option>
                        );
                      })}
                  </select>
                  {guestHost && targetDayRsvps[guestHost] !== 'going' && targetDayRsvps[guestHost] !== 'skip' && (
                    <div className="mt-1.5 text-[11px] text-amber-400/90">
                      ⚠️ {guestHost} hasn't RSVP'd — they'll be auto-marked Going (charged for their seat + the guest).
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Guest name (optional)</label>
                <input
                  type="text"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder={`${guestHost || myName}'s guest`}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-violet-500/60"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Skill level</label>
                <div className="flex gap-2">
                  {(['E', 'I', 'B'] as GuestLevel[]).map(lvl => (
                    <button
                      key={lvl}
                      onClick={() => setGuestLevel(lvl)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                        guestLevel === lvl
                          ? LEVEL_COLORS[lvl] + ' shadow-sm'
                          : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500'
                      }`}
                    >
                      <div>{lvl}</div>
                      <div className="text-xs font-normal mt-0.5 opacity-75">{LEVEL_LABELS[lvl]}</div>
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleConfirmAddGuest}
                disabled={guestHost !== null && !guestHost}
                className="w-full py-2.5 rounded-xl btn-gradient hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all shadow-lg shadow-[#7c5cff]/20"
              >
                {guestHost !== null ? (guestHost ? `Add Guest for ${guestHost}` : 'Pick a player above') : 'Add Guest'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HomeTab
// ---------------------------------------------------------------------------
export default function HomeTab() {
  const {
    myName, players, setShowNamePicker, showToast,
    playerTransfers, loadPlayerTransfers, extraSessions, isLoggedIn, settings,
  } = useApp();

  const [activeDay, setActiveDay] = useState<Day>('saturday');
  const [submitting, setSubmitting] = useState(false);
  const [showPayConfirm, setShowPayConfirm] = useState(false);
  const [activeExtraSession, setActiveExtraSession] = useState<number | null>(null);

  const activeExtraSessions = extraSessions.filter(s => {
    const [hours, minutes] = s.end_time.split(':').map(Number);
    const [year, month, day] = s.session_date.split('-').map(Number);
    const end = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return !s.cancelled && new Date() < end;
  });
  const [customAmount, setCustomAmount] = useState('50');

  useEffect(() => { fetchServerTimeOffset(); }, []);

  const myPlayer = players.find(p => p.name === myName);
  const myBalance = myPlayer?.balance ?? 0;
  const isLow = myBalance < 15;

  const myPendingTransfer = playerTransfers.find(
    t => t.player_name === myName && t.status === 'pending'
  );
  const myRecentConfirmed = playerTransfers.find(
    t => t.player_name === myName &&
      t.status === 'confirmed' &&
      (Date.now() - new Date(t.confirmed_at || t.created_at).getTime()) < 24 * 60 * 60 * 1000
  );

  const handleSubmitTransfer = async () => {
    if (!myName || submitting) return;
    if (myPendingTransfer) { showToast('You already have a pending transfer'); return; }
    const parsed = parseFloat(customAmount);
    if (!parsed || parsed <= 0) { showToast('Enter a valid amount'); return; }
    setSubmitting(true);
    await supabase.from('player_transfers').insert({
      player_name: myName, amount: parsed, recipient: settings.payment_recipient_name || 'Arun', method: 'Interac', status: 'pending',
    });
    await loadPlayerTransfers();
    notifyTransferSubmitted(myName, parsed);
    setSubmitting(false);
    showToast(`Transfer of $${parsed.toFixed(2)} submitted! Admin will confirm soon.`);
  };

  return (
    <div className="px-4 pt-4">


      <BroadcastBanner />

      {!myName && (
        <button
          onClick={() => setShowNamePicker(true)}
          className="w-full bg-violet-400/5 backdrop-blur-md border border-violet-400/20 hover:border-violet-400/50 transition-all rounded-2xl px-4 py-3 mb-3 flex items-center justify-between shadow-lg shadow-black/40"
          style={{ animation: 'heartbeat 1.6s ease-in-out infinite', transformOrigin: 'center' }}
        >
          <span className="text-sm text-violet-400 font-medium">Get started -- who are you?</span>
          <ChevronRight size={16} className="text-violet-400" />
        </button>
      )}

      {myName && myPlayer && isLoggedIn && (
        <div className={`neon-card !rounded-2xl mb-3`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs text-slate-400 mb-0.5">My Balance -- <span className="uppercase">{myName}</span></div>
              <div className={`text-2xl font-bold ${isLow ? 'text-red-400 blink' : 'text-emerald-400'}`}>
                ${myBalance.toFixed(2)}
              </div>
            </div>
            {myPendingTransfer && (
              <div className="flex items-center gap-1.5 bg-amber-900/30 border border-amber-700/30 text-amber-400 text-xs font-semibold px-3 py-1.5 rounded-lg">
                <Clock size={12} /> Pending
              </div>
            )}
          </div>

          {isLow && (
            <div className="text-xs text-red-400 mb-2 flex items-center gap-1.5">
              <AlertCircle size={12} className="flex-shrink-0" />
              Balance low! Top up soon.
            </div>
          )}

          {!myPendingTransfer && (
            <div className="border-t border-slate-700/40 pt-3">
              <div className="text-xs text-slate-500 mb-2">
                Send payment via Interac e-Transfer to {settings.payment_recipient_name || 'Arun'}, then notify below
              </div>
              <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/40 rounded-xl px-3 py-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-emerald-900/50 border border-emerald-700/40 flex items-center justify-center flex-shrink-0">
                  <span className="text-emerald-400 text-xs font-bold">$</span>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-500 leading-none mb-0.5">Interac e-Transfer</div>
                  <div className="text-xs font-semibold text-slate-200 truncate">{settings.payment_recipient_email || 'arun.gedela@gmail.com'}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="relative w-28 flex-shrink-0">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold pointer-events-none">$</span>
                  <input
                    type="number" min="1" step="1" value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    className="w-full bg-slate-800/80 border border-slate-600/60 rounded-xl pl-7 pr-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-violet-500/60"
                    placeholder="50"
                  />
                </div>
                <button
                  onClick={() => {
                    const parsed = parseFloat(customAmount);
                    if (!parsed || parsed <= 0) { showToast('Enter a valid amount'); return; }
                    setShowPayConfirm(true);
                  }}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 btn-gradient hover:brightness-110 disabled:bg-none disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl py-2.5 text-sm font-semibold transition-all shadow-lg shadow-[#7c5cff]/20"
                >
                  <Send size={14} />
                  {submitting ? 'Submitting...' : 'Notify Admin'}
                </button>
              </div>
            </div>
          )}

          {myPendingTransfer && (
            <div className="text-xs text-amber-400 mt-2 flex items-center gap-1.5">
              <Clock size={12} />
              Transfer of ${Number(myPendingTransfer.amount).toFixed(2)} submitted -- waiting for admin confirmation
            </div>
          )}
          {myRecentConfirmed && !myPendingTransfer && (
            <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1.5">
              <CheckCircle size={12} /> Last transfer confirmed!
            </div>
          )}
        </div>
      )}

{/* Row 1: Regular day tabs */}
<div className="flex gap-2 mb-2">
        {(['saturday', 'wednesday'] as Day[]).map(d => (
          <button
            key={d}
            onClick={() => { setActiveDay(d); setActiveExtraSession(null); }}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all capitalize ${
              activeDay === d && activeExtraSession === null
                ? 'btn-gradient border-transparent text-white shadow-lg shadow-[#7c5cff]/20'
                : 'bg-white/[0.05] border-violet-400/20 text-slate-400 hover:border-violet-400/40'
            }`}
          >
            {(() => {
              const wk = getUpcomingSessionWeekKey(d);
              const [y, m, dd2] = wk.split('-').map(Number);
              const sat = new Date(y, m - 1, dd2);
              const sessDate = d === 'saturday' ? sat : new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() - 3);
              const short = sessDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              return <>{d} <span className="text-[10px] opacity-70 ml-1">{short}</span></>;
            })()}
          </button>
        ))}
      </div>

      {/* Row 2: Extra session tabs (only shown when extras exist) */}
      {activeExtraSessions.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
          {activeExtraSessions.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveExtraSession(s.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap ${
                activeExtraSession === s.id
                  ? 'btn-gradient border-transparent text-white shadow-lg shadow-[#7c5cff]/20'
                  : 'bg-white/[0.05] border-violet-400/20 text-slate-400 hover:border-violet-400/40'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}
      {activeExtraSessions.length === 0 && <div className="mb-4" />}

      {/* Show regular session or extra session */}
      {activeExtraSession === null ? (
        <SessionCard day={activeDay} />
      ) : (
        <ExtraSessionCard
          session={activeExtraSessions.find(s => s.id === activeExtraSession)!}
        />
      )}
      {/* Payment confirmation modal */}
      {showPayConfirm && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-5"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              border: '1px solid rgba(124,92,255,0.3)',
              boxShadow: '0 0 40px rgba(124,92,255,0.2), 0 0 80px rgba(124,92,255,0.05)',
            }}>
            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(124,92,255,0.15), rgba(255,111,145,0.1))',
              borderBottom: '1px solid rgba(124,92,255,0.2)',
              padding: '20px 24px 16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>💸</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
                Confirm Payment
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Sending via Interac e-Transfer
              </div>
            </div>

            {/* Amount */}
            <div style={{ padding: '20px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Amount</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: '#7c5cff', marginBottom: 4 }}>
                ${parseFloat(customAmount).toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>to {settings.payment_recipient_name || 'Arun'} · {settings.payment_recipient_email || 'arun.gedela@gmail.com'}</div>

              <div style={{
                margin: '16px 0',
                padding: '12px 16px',
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.2)',
                borderRadius: 12,
                fontSize: 12,
                color: '#fbbf24',
                lineHeight: 1.5,
              }}>
                ⚠️ Only tap confirm if you have <strong>already sent</strong> the money via Interac. Admin will verify and update your balance.
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setShowPayConfirm(false)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12,
                    background: 'transparent', border: '1px solid #334155',
                    color: '#94a3b8', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowPayConfirm(false); handleSubmitTransfer(); }}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12,
                    background: 'linear-gradient(135deg, #5b6cff, #7c5cff)',
                    border: 'none', color: '#fff',
                    fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    boxShadow: '0 0 20px rgba(124,92,255,0.3)',
                  }}
                >
                  ✅ Yes, I sent it!
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="h-6" />

      <div className="h-6" />
    </div>
  );
}