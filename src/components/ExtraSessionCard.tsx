import { useState, useCallback } from 'react';
import { X, Clock, AlertCircle, UserPlus, Lock, Unlock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { makeInitials } from '../lib/constants';
import { isExtraSessionEnded, isExtraCutoffPassed } from '../lib/cutoff';
import type { ExtraSession, GuestLevel } from '../types';

const LEVEL_COLORS: Record<GuestLevel, string> = {
  E: 'bg-emerald-900/50 text-emerald-400 border-emerald-700/40',
  I: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/40',
  B: 'bg-amber-900/50 text-amber-400 border-amber-700/40',
};
const LEVEL_LABELS: Record<GuestLevel, string> = { E: 'Experienced', I: 'Intermediate', B: 'Beginner' };

export default function ExtraSessionCard({ session }: { session: ExtraSession }) {
  const {
    myName, players, showToast,
    loadExtraSessionRsvps, extraSessionRsvps,
    extraSessionGuests, loadExtraSessionGuests,
    verifyAdminPin, ratePerCourt,
    handleToggleExtraSessionLock, handleSendExtraSessionEmails,
    completeExtraSession, currentUser,
  } = useApp();

  const [guestModal, setGuestModal] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestLevel, setGuestLevel] = useState<GuestLevel>('I');
  const [costOverride, setCostOverride] = useState<string>('');

  const isAdmin = currentUser?.role === 'admin';

  const sessionRsvps = extraSessionRsvps.filter(r => r.session_id === session.id);
  const goingPlayers = sessionRsvps.filter(r => r.status === 'going').map(r => r.player_name);
  const myStatus = myName ? sessionRsvps.find(r => r.player_name === myName)?.status : undefined;

  const sessionGuestRows = extraSessionGuests.filter(g => g.session_id === session.id);
  const allGuests = sessionGuestRows.flatMap(row => {
    try {
      const friends: { name: string; level?: GuestLevel }[] = JSON.parse(row.friends);
      return friends.map(f => ({ ...f, brought_by: row.brought_by }));
    } catch { return []; }
  });
  const myGuestRow = sessionGuestRows.find(g => g.brought_by === myName);
  const myGuests: { name: string; level?: GuestLevel }[] = myGuestRow ? (() => {
    try { return JSON.parse(myGuestRow.friends); } catch { return []; }
  })() : [];
  const myGuestCount = myGuests.length;

  const isLocked = session.locked ?? false;

  // Judge cutoff and "has the session ended?" in Pacific time regardless of
  // device timezone. The old code used `new Date()` (device-local) which made
  // cutoffs and session-end checks fire at the wrong wall-clock time for any
  // viewer not in the Pacific zone.
  const cutoffPassed = session.cutoff_time ? isExtraCutoffPassed(session.cutoff_time) : false;
  const sessionExpired = isExtraSessionEnded(session.session_date, session.end_time);

  const totalGoing = goingPlayers.length + allGuests.length;
  // Correct hourly cost: ratePerCourt is the 2-hour rate, so divide by 2 for per-hour rate
  const [startH, startM] = session.start_time.split(':').map(Number);
  const [endH, endM] = session.end_time.split(':').map(Number);
  const sessionHours = ((endH * 60 + endM) - (startH * 60 + startM)) / 60;
  const totalCost = session.courts.length * (ratePerCourt / 2) * sessionHours;
  const perPerson = totalGoing > 0 ? totalCost / totalGoing : 0;

  const handleRsvp = useCallback(async (status: 'going' | 'skip') => {
    if (!myName) { showToast('Please select your name first'); return; }
    if (isLocked) { showToast('Voting is locked by admin 🔒'); return; }
    if (cutoffPassed && status === 'skip') { showToast('Cannot cancel after cutoff'); return; }
    await supabase.from('extra_session_rsvps').upsert(
      { session_id: session.id, player_name: myName, status },
      { onConflict: 'session_id,player_name' }
    );
    await loadExtraSessionRsvps();
    showToast(status === 'going' ? "You're in!" : "Marked as not coming");
  }, [myName, session.id, cutoffPassed, showToast, loadExtraSessionRsvps]);

  const handleAddGuest = useCallback(() => {
    if (!myName || myGuestCount >= 2) return;
    setGuestName('');
    setGuestLevel('I');
    setGuestModal(true);
  }, [myName, myGuestCount]);

  const handleConfirmAddGuest = useCallback(async () => {
    if (!myName) return;
    const name = guestName.trim() || `${myName}'s guest`;
    const newGuest = { name, level: guestLevel };
    const updated = [...myGuests, newGuest];
    setGuestModal(false);
    await supabase.from('extra_session_guests').upsert(
      { session_id: session.id, brought_by: myName, friends: JSON.stringify(updated) },
      { onConflict: 'session_id,brought_by' }
    );
    await loadExtraSessionGuests();
    showToast('Guest added!');
  }, [myName, guestName, guestLevel, myGuests, session.id, loadExtraSessionGuests, showToast]);

  const handleRemoveGuest = useCallback(async (index: number) => {
    if (!myName) return;
    if (cutoffPassed) { showToast('Cannot remove guests after cutoff'); return; }
    const updated = myGuests.filter((_, i) => i !== index);
    if (updated.length === 0) {
      await supabase.from('extra_session_guests').delete()
        .eq('session_id', session.id).eq('brought_by', myName);
    } else {
      await supabase.from('extra_session_guests').upsert(
        { session_id: session.id, brought_by: myName, friends: JSON.stringify(updated) },
        { onConflict: 'session_id,brought_by' }
      );
    }
    await loadExtraSessionGuests();
  }, [myName, myGuests, cutoffPassed, session.id, showToast, loadExtraSessionGuests]);

  const handleAdminRemoveGuest = useCallback(async (broughtBy: string, index: number) => {
    if (!verifyAdminPin()) return;
    if (!window.confirm(`Remove guest of ${broughtBy}?`)) return;
    const row = sessionGuestRows.find(g => g.brought_by === broughtBy);
    if (!row) return;
    let friends: { name: string; level?: GuestLevel }[] = [];
    try { friends = JSON.parse(row.friends); } catch { friends = []; }
    const updated = friends.filter((_, i) => i !== index);
    if (updated.length === 0) {
      await supabase.from('extra_session_guests').delete()
        .eq('session_id', session.id).eq('brought_by', broughtBy);
    } else {
      await supabase.from('extra_session_guests').upsert(
        { session_id: session.id, brought_by: broughtBy, friends: JSON.stringify(updated) },
        { onConflict: 'session_id,brought_by' }
      );
    }
    await loadExtraSessionGuests();
    showToast('Guest removed ✓');
  }, [session.id, sessionGuestRows, verifyAdminPin, showToast, loadExtraSessionGuests]);

  const handleAdminRemove = useCallback(async (playerName: string) => {
    if (!verifyAdminPin()) return;
    if (!window.confirm(`Remove ${playerName} from this session?`)) return;
    await supabase.from('extra_session_rsvps')
      .delete()
      .eq('session_id', session.id)
      .eq('player_name', playerName);
    await loadExtraSessionRsvps();
    showToast(`${playerName} removed ✓`);
  }, [session.id, verifyAdminPin, showToast, loadExtraSessionRsvps]);

  const handleAdminAddPlayer = useCallback(async (playerName: string) => {
    if (!verifyAdminPin()) return;
    await supabase.from('extra_session_rsvps').upsert(
      { session_id: session.id, player_name: playerName, status: 'going' },
      { onConflict: 'session_id,player_name' }
    );
    await loadExtraSessionRsvps();
    showToast(`${playerName} added ✓`);
  }, [session.id, verifyAdminPin, showToast, loadExtraSessionRsvps]);

  const notGoingNames = players
    .filter(p => !p.archived && !goingPlayers.includes(p.name))
    .map(p => p.name)
    .sort((a, b) => a.localeCompare(b));

  const handleCancel = useCallback(async () => {
    if (!verifyAdminPin()) return;
    if (!window.confirm(`Cancel "${session.title}" session?`)) return;
    await supabase.from('extra_sessions').update({ cancelled: true }).eq('id', session.id);
    await loadExtraSessionRsvps();
    showToast('Session cancelled');
  }, [session.id, session.title, verifyAdminPin, loadExtraSessionRsvps, showToast]);

  if (sessionExpired) return null;

  const sessionDate = new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric'
  });

  const allAttendees = [
    ...goingPlayers.map(n => ({ name: n, isGuest: false, broughtBy: undefined as string | undefined, level: undefined as GuestLevel | undefined })),
    ...allGuests.map(g => ({ name: g.name, isGuest: true, broughtBy: g.brought_by, level: g.level })),
  ];

  return (
    <div className={`neon-card mb-3 ${session.cancelled ? 'card-rose' : 'card-amber'}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-base font-semibold text-slate-100">{session.title}</div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-700/30">
              Extra
            </span>
          </div>
          <div className="text-xs text-slate-400">{sessionDate}</div>
          <div className="text-xs text-slate-400">{session.start_time} – {session.end_time}</div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
          session.cancelled
            ? 'bg-red-900/40 text-red-400'
            : isLocked
            ? 'bg-amber-900/40 text-amber-400'
            : cutoffPassed
            ? 'bg-slate-700 text-slate-400'
            : 'bg-amber-900/40 text-amber-400'
        }`}>
          {session.cancelled ? 'Cancelled' : isLocked ? '🔒 Locked' : cutoffPassed ? 'Cutoff passed' : 'Open'}
        </span>
      </div>

      {/* Lock banner */}
      {isLocked && !session.cancelled && (
        <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 mb-3 text-xs flex items-center gap-1.5 text-amber-400">
          <Lock size={12} className="flex-shrink-0" />
          <span>Voting locked by admin — attendance is final</span>
        </div>
      )}

      {/* Admin lock/unlock button */}
      {!session.cancelled && !session.auto_deducted && (
        <button
          onClick={async () => {
            if (!verifyAdminPin()) return;
            await handleToggleExtraSessionLock(session.id, !isLocked);
          }}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border mb-3 transition-colors ${
            isLocked
              ? 'border-amber-700/30 bg-amber-900/20 text-amber-400'
              : 'border-slate-700/60 bg-white/[0.04] text-slate-400 hover:border-violet-400/40'
          }`}
        >
          {isLocked ? <><Unlock size={12} /> Unlock RSVPs</> : <><Lock size={12} /> Lock RSVPs</>}
        </button>
      )}

      {session.cancelled && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2 mb-3 text-xs text-red-400">
          Session cancelled by admin
        </div>
      )}

      {/* Finalize banner — shown when session has ended and not yet finalized */}
      {sessionExpired && !session.auto_deducted && !session.cancelled && isAdmin && (
        <div className="rounded-xl px-4 py-3 mb-3 border border-amber-400/30"
          style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(234,88,12,0.06))' }}>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-amber-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-amber-300">Session ended — finalize to apply charges</span>
          </div>
          <div className="text-xs text-slate-400 mb-3">
            <span className="text-amber-300 font-medium">{totalGoing} player{totalGoing !== 1 ? 's' : ''} going</span>
            {' · '}Auto cost: <span className="text-amber-300">${totalCost.toFixed(2)}</span>
          </div>
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
                placeholder={`Auto: $${totalCost.toFixed(2)}`}
                value={costOverride}
                onChange={e => setCostOverride(e.target.value)}
                className="flex-1 bg-white/[0.06] border border-slate-600/40 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
              />
            </div>
          </div>
          <button
            onClick={async () => {
              if (!verifyAdminPin()) return;
              const override = costOverride.trim() !== '' ? parseFloat(costOverride) : undefined;
              await completeExtraSession(session.id, override);
              setCostOverride('');
            }}
            className="w-full py-2 rounded-xl btn-gradient hover:brightness-110 text-white text-xs font-semibold transition-all"
          >
            ✓ Finalize session & apply charges
          </button>
        </div>
      )}

      {/* Send emails button — shown after session is finalized, admin only */}
      {session.auto_deducted && !session.cancelled && (
        <div className="rounded-xl px-4 py-3 mb-3 border border-violet-400/20"
          style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), color-mix(in srgb, var(--accent-2) 6%, transparent))' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-violet-300">✅ Fees Deducted</span>
          </div>
          <div className="text-xs text-slate-400 mb-2">
            {session.players_count ?? 0} players · {session.courts.length} court{session.courts.length !== 1 ? 's' : ''} · {session.per_person ? `$${Number(session.per_person).toFixed(2)}/person` : '—'}
          </div>
          {isAdmin && (
            <button
              onClick={async () => {
                await handleSendExtraSessionEmails(session.id);
              }}
              className="w-full py-2 rounded-xl bg-white/[0.06] border border-violet-400/20 hover:border-violet-400/40 text-violet-300 text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
            >
              📧 Send session emails
            </button>
          )}
        </div>
      )}

      {!session.cancelled && session.cutoff_time && (
        <div className="rounded-lg px-3 py-2 mb-3 text-xs flex items-center gap-1.5 bg-amber-900/20 border border-amber-700/30 text-amber-400">
          <Clock size={12} className="flex-shrink-0" />
          <span>
            {cutoffPassed
              ? 'Cutoff passed — you can still join!'
              : `Cutoff: ${new Date(session.cutoff_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${new Date(session.cutoff_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
            }
          </span>
        </div>
      )}

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {session.courts.map(c => (
          <span key={c} className="bg-amber-900/30 text-amber-400 text-xs font-semibold px-2 py-1 rounded-full border border-amber-700/30">
            Court {c}
          </span>
        ))}
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>{totalGoing} going</span>
        </div>
        <div className="progress-bar-wrap">
          <div className="progress-fill" style={{ width: `${Math.min(100, totalGoing * 10)}%` }} />
        </div>
      </div>

      {perPerson > 0 && (
        <div className="text-xs text-slate-400 mb-3">
          Est. cost: <span className="text-amber-400 font-semibold">${perPerson.toFixed(2)}/person</span>
        </div>
      )}

      {/* RSVP buttons */}
      {!session.cancelled && (
        <>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => handleRsvp('going')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                myStatus === 'going'
                  ? 'bg-amber-500 border-amber-500 text-white shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                  : 'bg-transparent border-slate-700 text-slate-300 hover:border-amber-500/50'
              }`}
            >
              Going
            </button>
            {!cutoffPassed && (
              <button
                onClick={() => handleRsvp('skip')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                  myStatus === 'skip'
                    ? 'bg-red-500/80 border-red-500 text-white'
                    : 'bg-transparent border-slate-700 text-slate-300 hover:border-red-500/50'
                }`}
              >
                Not coming
              </button>
            )}
          </div>
          {cutoffPassed && (
            <div className="flex items-start gap-1.5 mb-3 text-xs text-amber-400/80">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>You can still join, but cannot cancel after cutoff.</span>
            </div>
          )}
        </>
      )}

      {/* Guest panel */}
      {!session.cancelled && (myStatus === 'going' || myStatus === 'skip') && (
        <div className="bg-slate-800/60 rounded-xl px-4 py-3 mb-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <UserPlus size={14} className="text-slate-400" />
              <span className="text-xs text-slate-400">
                Guests ({myGuestCount}/2)
                {myStatus === 'skip' && (
                  <span className="text-amber-400 ml-1">— you'll be charged for your guests</span>
                )}
              </span>
            </div>
            {myGuestCount < 2 && !cutoffPassed && (
              <button
                onClick={handleAddGuest}
                className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
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
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${LEVEL_COLORS[g.level]}`}>{g.level}</span>
              )}
              {!cutoffPassed && (
                <button
                  onClick={() => handleRemoveGuest(i)}
                  className="w-6 h-6 rounded-full bg-slate-700 hover:bg-red-900/60 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors"
                ><X size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Guest modal */}
      {guestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-5" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-xs rounded-2xl overflow-hidden border border-slate-700" style={{ background: 'rgba(15,20,30,0.98)' }}>
            <div className="px-4 pt-4 pb-3 border-b border-slate-700/50 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-100">Add Guest</span>
              <button onClick={() => setGuestModal(false)} className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Guest name (optional)</label>
                <input
                  type="text"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder={`${myName}'s guest`}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
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
                className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors"
              >
                Add Guest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance */}
      {allAttendees.length > 0 && (
        <div className="border-t border-slate-800/60 pt-3 mt-2">
          <div className="text-xs font-medium text-slate-500 mb-2">
            Attendance ({allAttendees.length})
          </div>
          <div className="flex flex-col gap-1.5">
            {allAttendees.map((a, i) => {
              const player = players.find(p => p.name === a.name);
              const initials = a.isGuest ? 'G' : makeInitials(a.name);
              const bg = a.isGuest ? 'rgba(14,116,144,0.2)' : (player?.color.bg ?? 'rgba(100,100,100,0.2)');
              const fg = a.isGuest ? '#22d3ee' : (player?.color.fg ?? '#aaa');
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs w-4 text-white">{i + 1}.</span>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                    style={{ background: bg, color: fg }}
                  >{initials}</div>
                  <span className="text-sm text-slate-300 flex-1">{a.name}</span>
                  {a.isGuest && a.broughtBy && (
                    <span className="text-xs text-slate-500">by {a.broughtBy}</span>
                  )}
                  {a.isGuest && a.level && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${LEVEL_COLORS[a.level]}`}>{a.level}</span>
                  )}
                  {!a.isGuest && isAdmin && (
                    <button
                      onClick={() => handleAdminRemove(a.name)}
                      className="w-6 h-6 rounded-full bg-red-900/20 hover:bg-red-900/50 text-red-400/50 hover:text-red-400 flex items-center justify-center transition-colors"
                    ><X size={10} /></button>
                  )}
                  {a.isGuest && a.broughtBy && isAdmin && (
                    <button
                      onClick={() => {
                        const row = sessionGuestRows.find(g => g.brought_by === a.broughtBy);
                        if (!row) return;
                        let friends: { name: string }[] = [];
                        try { friends = JSON.parse(row.friends); } catch { friends = []; }
                        const idx = friends.findIndex((_, fi) => {
                          const hostGuests = allGuests.filter(g => g.brought_by === a.broughtBy);
                          return hostGuests[fi]?.name === a.name;
                        });
                        handleAdminRemoveGuest(a.broughtBy!, idx >= 0 ? idx : 0);
                      }}
                      className="w-6 h-6 rounded-full bg-red-900/20 hover:bg-red-900/50 text-red-400/50 hover:text-red-400 flex items-center justify-center transition-colors"
                    ><X size={10} /></button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin: add player to session */}
      {isAdmin && !session.cancelled && !session.auto_deducted && notGoingNames.length > 0 && (
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

      {/* Admin cancel button */}
      {!session.cancelled && (
        <div className="border-t border-slate-800/60 pt-2 mt-3">
          <button
            onClick={handleCancel}
            className="text-xs text-red-400/50 hover:text-red-400 transition-colors"
          >
            Cancel this session (admin)
          </button>
        </div>
      )}
    </div>
  );
}