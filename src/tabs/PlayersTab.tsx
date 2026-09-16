import { useState, useRef, useMemo, useCallback } from 'react';
import { Plus, Trash2, Mail, Check, X, Archive, ArchiveRestore, Camera, ChevronDown, Receipt } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';

import { COLORS, makeInitials } from '../lib/constants';
import { uploadAvatarFor, removeAvatarFor } from '../lib/avatar';
import PlayerAvatar from '../components/PlayerAvatar';

const SKILL_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  E: { label: 'E', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  I: { label: 'I', color: 'text-indigo-400',  bg: 'bg-indigo-500/10 border-indigo-500/30' },
  B: { label: 'B', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
};

const AURORA_GLOW = { animation: 'cardGlowPulseRed 4s ease-in-out infinite' };
const AURORA_CARD_BG = { background: 'linear-gradient(155deg, color-mix(in srgb, var(--accent) 10%, transparent), rgba(255,255,255,0.03) 45%, color-mix(in srgb, var(--accent-2) 6%, transparent))', animation: 'cardGlowPulse 4s ease-in-out infinite' };

export default function PlayersTab() {
  const { players, setPlayers, showToast, verifyAdminPin, settings, loadPlayers,
    handleSettleAndArchive, handleUnarchivePlayer, currentUser, completedSessions } = useApp();
  const isAdmin = currentUser?.role === 'admin';
  const [newName, setNewName] = useState('');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The club's banker — the person who fronts venue payments from their own
  // pocket. Their negative balance is money the CLUB OWES THEM, not debt, so it
  // is reported separately rather than mixed into the players' pool.
  // Configurable via the `fund_manager` setting; falls back to admin2 for
  // backwards-compatibility with the old behaviour.
  const fundManager = settings.fund_manager || settings.admin2 || '';

  const handleAddPlayer = async () => {
    const name = newName.trim();
    if (!name) return;
    if (!verifyAdminPin()) return;
    if (players.find(p => p.name.toLowerCase() === name.toLowerCase())) {
      showToast('Player already exists');
      return;
    }
    const colorIndex = players.length % COLORS.length;
    const color = COLORS[colorIndex];
    const initials = makeInitials(name);
    const newPlayer = { name, skill: null, balance: 0, color, initials };
    await supabase.from('players').upsert({ name, skill: null }, { onConflict: 'name' });
    setPlayers(prev => [...prev, newPlayer]);
    setNewName('');
    showToast(`${name} added!`);
  };

  const handleDeletePlayer = async (name: string) => {
    if (!verifyAdminPin()) return;
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    await supabase.from('players').delete().eq('name', name);
    setPlayers(prev => prev.filter(p => p.name !== name));
    showToast(`${name} removed`);
  };

  const handleSetSkill = async (name: string, skill: string | null) => {
    if (!verifyAdminPin()) return;
    await supabase.from('players').update({ skill }).eq('name', name);
    setPlayers(prev => prev.map(p => p.name === name ? { ...p, skill } : p));
  };

  const handleLongPressStart = (name: string) => {
    longPressTimer.current = setTimeout(() => handleDeletePlayer(name), 700);
  };
  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // ── Admin avatar management ─────────────────────────────────────────────────
  // Admins can add / replace / remove any player's photo. Players can still
  // change their own from the profile menu, so nothing here locks them out.
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarTarget, setAvatarTarget] = useState<string | null>(null);
  const [uploadingAvatarFor, setUploadingAvatarFor] = useState<string | null>(null);

  const openAvatarPicker = (playerName: string) => {
    setAvatarTarget(playerName);
    avatarInputRef.current?.click();
  };

  const handleAdminAvatarFile = async (file: File | undefined) => {
    const target = avatarTarget;
    if (!file || !target) return;
    setUploadingAvatarFor(target);
    try {
      await uploadAvatarFor(target, file);
      await loadPlayers();
      showToast(`Photo updated for ${target}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingAvatarFor(null);
      setAvatarTarget(null);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleAdminRemoveAvatar = async (playerName: string) => {
    if (!window.confirm(`Remove ${playerName}'s photo?`)) return;
    setUploadingAvatarFor(playerName);
    try {
      await removeAvatarFor(playerName);
      await loadPlayers();
      showToast(`Photo removed for ${playerName}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setUploadingAvatarFor(null);
    }
  };

  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState('');

  // ── Per-player transaction history ──────────────────────────────────────────
  const [txPlayer, setTxPlayer] = useState<string | null>(null);
  const [playerTxns, setPlayerTxns] = useState<Record<string, { id: string; type: string; amount: number; created_at: string; note?: string | null }[]>>({});
  const [loadingTxns, setLoadingTxns] = useState<string | null>(null);

  const TX_LABELS: Record<string, string> = {
    top_up: 'Top-Up',
    match_charge: 'Match Charge',
    misc_charge: 'Misc Charge',
    adjustment: 'Adjustment',
  };
  const TX_COLORS: Record<string, string> = {
    top_up: 'text-violet-400',
    match_charge: 'text-red-400',
    misc_charge: 'text-orange-400',
    adjustment: 'text-yellow-400',
  };

  const toggleTxns = useCallback(async (playerName: string, playerId?: string) => {
    if (txPlayer === playerName) { setTxPlayer(null); return; }
    setTxPlayer(playerName);
    if (playerTxns[playerName] || !playerId) return;
    setLoadingTxns(playerName);
    const { data } = await supabase
      .from('transactions')
      .select('id, type, amount, created_at, note')
      .eq('player_id', playerId)
      .order('created_at', { ascending: false })
      .limit(15);
    setPlayerTxns(prev => ({ ...prev, [playerName]: data ?? [] }));
    setLoadingTxns(null);
  }, [txPlayer, playerTxns]);

  const handleEditEmail = (name: string, currentEmail: string | null | undefined) => {
    setEditingEmail(name);
    setEmailDraft(currentEmail ?? '');
  };

  const handleSaveEmail = async (name: string) => {
    const trimmed = emailDraft.trim().toLowerCase();
    await supabase.from('players').update({ email: trimmed || null }).eq('name', name);
    setPlayers(prev => prev.map(p => p.name === name ? { ...p, email: trimmed || null } : p));
    setEditingEmail(null);
    showToast('Email saved');
  };

  const handleCancelEmail = () => {
    setEditingEmail(null);
    setEmailDraft('');
  };

  const activePlayers = players.filter(p => !p.archived);
  const archivedPlayers = players.filter(p => p.archived);
  const [showArchived, setShowArchived] = useState(false);

  const isFundManager = (name: string) =>
    !!fundManager && name.trim().toLowerCase() === fundManager.trim().toLowerCase();

  // The banker's negative balance is the club's debt to them, not a low balance
  // — don't flag them alongside players who genuinely need to top up.
  const lowBalancePlayers = activePlayers.filter(
    p => p.balance < 15 && !isFundManager(p.name)
  ).length;

  // Players' pool — everyone except the banker. This is real money the club holds.
  const totalBalance = useMemo(() => {
    return activePlayers
      .filter(p => !isFundManager(p.name))
      .reduce((sum, p) => {
        const balance = Number(p.balance) || 0;
        return sum + balance;
      }, 0);
  }, [players, fundManager]);

  // Owed to the banker — their negative balance, shown as a positive "we owe"
  // figure. Zero if they're square or the club owes them nothing.
  const owedToManager = useMemo(() => {
    const mgr = activePlayers.find(p => isFundManager(p.name));
    if (!mgr) return 0;
    const bal = Number(mgr.balance) || 0;
    return bal < 0 ? Math.abs(bal) : 0;
  }, [players, fundManager]);

  const sorted = [...activePlayers].sort((a, b) => a.name.localeCompare(b.name));

  // All-time attendance % — regular sessions only (Saturday/Wednesday), not extras.
  const regularSessions = useMemo(
    () => completedSessions.filter(s => !s.is_extra),
    [completedSessions]
  );
  const attendancePct = useMemo(() => {
    const totalSessions = regularSessions.length;
    const map: Record<string, number> = {};
    if (totalSessions === 0) return map;
    activePlayers.forEach(p => {
      const attended = regularSessions.filter(s => s.players?.includes(p.name)).length;
      map[p.name] = Math.round((attended / totalSessions) * 100);
    });
    return map;
  }, [regularSessions, activePlayers]);

  return (
    <div className="px-4 pt-4 pb-24 overflow-y-auto">
      {/* STATS SECTION */}
      <div className="flex gap-3 mb-5">
        <div
          style={AURORA_CARD_BG}
          className="backdrop-blur-md border border-violet-400/20 p-3 rounded-2xl flex-1 text-center"
        >
          <div className="text-2xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-indigo-400">{players.length}</div>
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-0.5">Players</div>
        </div>
        <div
          style={AURORA_CARD_BG}
          className="backdrop-blur-md border border-violet-400/20 p-3 rounded-2xl flex-1 text-center"
        >
          <div className="text-2xl font-black tracking-tight text-red-400">{lowBalancePlayers}</div>
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-0.5">Low Balance</div>
        </div>
        <div
          style={AURORA_CARD_BG}
          className="backdrop-blur-md border border-violet-400/20 p-3 rounded-2xl flex-1 text-center"
        >
          <div className="text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">
            ${totalBalance.toFixed(2)}
          </div>
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-0.5">Players' Pool</div>
        </div>
      </div>

      {/* OWED TO THE CLUB'S BANKER — shown separately so the pool above isn't
          misread as "the club is flush" while this debt is outstanding. */}
      {owedToManager > 0 && (
        <div
          style={AURORA_CARD_BG}
          className="backdrop-blur-md border border-amber-400/25 p-3 rounded-2xl mb-5 flex items-center justify-between"
        >
          <div className="text-left">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Club owes {fundManager}</div>
            <div className="text-[9px] text-slate-500 mt-0.5">Fronted for court bookings</div>
          </div>
          <div className="text-xl font-black tracking-tight text-amber-400">
            ${owedToManager.toFixed(2)}
          </div>
        </div>
      )}

      {/* ADD PLAYER SECTION */}
      {/* Shared hidden file input for admin avatar uploads (one per list, the
          target player is tracked in state). */}
      {isAdmin && (
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => handleAdminAvatarFile(e.target.files?.[0])}
        />
      )}

      <div className="flex gap-2 mb-5">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddPlayer()}
          placeholder="Add new player..."
          className="flex-1 bg-slate-950/40 border border-slate-800/80 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500/50 transition-all backdrop-blur-md"
        />
        <button
          onClick={handleAddPlayer}
          className="bg-gradient-to-r from-violet-600 to-teal-600 hover:from-violet-500 hover:to-teal-500 text-white rounded-xl px-4 py-2.5 flex items-center gap-1.5 text-sm font-bold tracking-wide transition-all active:scale-95 shadow-md shadow-violet-950/20"
        >
          <Plus size={16} className="stroke-[2.5]" /> Add
        </button>
      </div>

      {/* ROSTER LIST */}
      <div className="flex flex-col gap-2.5">
        {sorted.map(p => {
          const isLow = p.balance < 15 && !isFundManager(p.name);
          return (
            <div
              key={p.name}
              style={isLow ? AURORA_GLOW : AURORA_CARD_BG}
              className={`relative flex flex-col gap-2.5 rounded-2xl p-3 border backdrop-blur-sm transition-all duration-300 ${
                isLow
                  ? 'bg-red-950/10 border-red-500/20'
                  : 'border-violet-400/20'
              }`}
            >
              <div
                className="flex items-center gap-3"
                onTouchStart={() => handleLongPressStart(p.name)}
                onTouchEnd={handleLongPressEnd}
                onMouseDown={() => handleLongPressStart(p.name)}
                onMouseUp={handleLongPressEnd}
                onMouseLeave={handleLongPressEnd}
              >
                {/* Avatar — photo if uploaded, otherwise colored initials.
                    Admins can tap to add/replace, and remove via the × badge.
                    Pointer handlers are stopped so tapping the avatar never
                    triggers the row's long-press-to-delete. */}
                {isAdmin ? (
                  <div
                    className="relative flex-shrink-0"
                    onTouchStart={e => e.stopPropagation()}
                    onTouchEnd={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onMouseUp={e => e.stopPropagation()}
                  >
                    <button
                      onClick={e => { e.stopPropagation(); openAvatarPicker(p.name); }}
                      title={`Change ${p.name}'s photo`}
                      className="block rounded-full focus:outline-none group/av relative"
                      disabled={uploadingAvatarFor === p.name}
                    >
                      <PlayerAvatar player={p} size={44} />
                      <span className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover/av:opacity-100 transition-opacity flex items-center justify-center">
                        <Camera size={15} className="text-white" />
                      </span>
                      {uploadingAvatarFor === p.name && (
                        <span className="absolute inset-0 rounded-full bg-black/65 flex items-center justify-center">
                          <span className="text-[9px] font-bold text-white">…</span>
                        </span>
                      )}
                    </button>
                    {p.avatar_url && uploadingAvatarFor !== p.name && (
                      <button
                        onClick={e => { e.stopPropagation(); handleAdminRemoveAvatar(p.name); }}
                        title={`Remove ${p.name}'s photo`}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center hover:bg-red-900/70 transition-colors"
                      >
                        <X size={9} className="text-slate-300" />
                      </button>
                    )}
                  </div>
                ) : (
                  <PlayerAvatar player={p} size={44} />
                )}

                {/* PLAYER NAME */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-100 tracking-normal truncate">{p.name}</div>
                </div>

                {/* SKILL SELECTOR */}
                <div className="flex items-center gap-1 bg-slate-950/30 p-0.5 rounded-lg border border-slate-900/40">
                  {(['E', 'I', 'B'] as const).map(level => {
                    const s = SKILL_LABELS[level];
                    const active = p.skill === level;
                    return (
                      <button
                        key={level}
                        onClick={e => { e.stopPropagation(); handleSetSkill(p.name, active ? null : level); }}
                        className={`w-6 h-6 rounded-md border text-[10px] font-black transition-all ${
                          active
                            ? `${s.bg} ${s.color} border-opacity-100 scale-105 shadow-sm`
                            : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'
                        }`}
                        title={level === 'E' ? 'Expert' : level === 'I' ? 'Intermediate' : 'Beginner'}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>

                {/* BALANCE + ATTENDANCE */}
                <div className="flex items-center gap-2 ml-1">
                  {isLow && (
                    <span className="text-base animate-pulse" title="Low balance!">💸</span>
                  )}
                  <span className={`text-xs font-black tracking-tight tabular-nums ${isLow ? 'text-red-400' : 'text-teal-400'}`}>
                    ${p.balance.toFixed(2)}
                  </span>
                </div>

                <button
                  onClick={e => { e.stopPropagation(); handleDeletePlayer(p.name); }}
                  className="text-slate-600 hover:text-red-400 transition-colors p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* EMAIL SUBSYSTEM */}
              {editingEmail === p.name ? (
                <div className="flex items-center gap-2 pl-1.5" onClick={e => e.stopPropagation()}>
                  <Mail size={12} className="text-violet-500 flex-shrink-0" />
                  <input
                    type="email"
                    value={emailDraft}
                    onChange={e => setEmailDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEmail(p.name); if (e.key === 'Escape') handleCancelEmail(); }}
                    placeholder="your@email.com"
                    autoFocus
                    className="flex-1 bg-slate-950/40 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-violet-500/40"
                  />
                  <button onClick={() => handleSaveEmail(p.name)} className="text-teal-400 hover:text-teal-300 transition-colors p-0.5"><Check size={14} /></button>
                  <button onClick={handleCancelEmail} className="text-slate-500 hover:text-slate-300 transition-colors p-0.5"><X size={14} /></button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-2 pl-1.5 text-left group max-w-[calc(100%-3rem)]"
                  onClick={e => { e.stopPropagation(); handleEditEmail(p.name, p.email); }}
                >
                  <Mail size={12} className={p.email ? 'text-violet-500/80' : 'text-slate-600'} />
                  <span className={`text-[11px] font-medium tracking-wide transition-colors truncate ${p.email ? 'text-slate-400/80 group-hover:text-slate-300' : 'text-slate-600 group-hover:text-slate-400'}`}>
                    {p.email ?? 'Add email...'}
                  </span>
                </button>
              )}

              {/* Transaction history toggle */}
              <button
                onClick={e => { e.stopPropagation(); toggleTxns(p.name, p.id); }}
                className="flex items-center gap-1.5 text-[10px] text-slate-600 hover:text-violet-400 transition-colors mt-0.5"
              >
                <Receipt size={10} />
                Transactions
                <ChevronDown size={10} className={`transition-transform ${txPlayer === p.name ? 'rotate-180' : ''}`} />
              </button>

              {/* Transaction history list */}
              {txPlayer === p.name && (
                <div className="mt-1 rounded-lg border border-white/[0.06] bg-slate-950/30 overflow-hidden" onClick={e => e.stopPropagation()}>
                  {loadingTxns === p.name ? (
                    <div className="text-[11px] text-slate-500 text-center py-3 animate-pulse">Loading…</div>
                  ) : (playerTxns[p.name]?.length ?? 0) === 0 ? (
                    <div className="text-[11px] text-slate-600 text-center py-3">No transactions yet</div>
                  ) : (
                    <div className="flex flex-col max-h-44 overflow-y-auto">
                      {playerTxns[p.name].map(t => {
                        const amt = Number(t.amount);
                        return (
                          <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04] last:border-b-0">
                            <div className="flex-1 min-w-0">
                              <span className={`text-[11px] font-medium ${TX_COLORS[t.type] ?? 'text-slate-400'}`}>
                                {TX_LABELS[t.type] ?? t.type}
                              </span>
                              <span className="text-[10px] text-slate-600 ml-1.5">
                                {new Date(t.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                              </span>
                              {t.note && (
                                <div className="text-[10px] text-slate-600 truncate">{t.note}</div>
                              )}
                            </div>
                            <span className={`text-[11px] font-semibold tabular-nums ${amt >= 0 ? 'text-violet-400' : 'text-red-400'}`}>
                              {amt >= 0 ? '+' : '-'}${Math.abs(amt).toFixed(2)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Settle & Archive — admin only */}
              {isAdmin && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (!verifyAdminPin()) return;
                    if (!window.confirm(`Settle & archive ${p.name}?\n\nCurrent balance: ${p.balance.toFixed(2)}\nThis will zero their balance and remove them from active views.`)) return;
                    handleSettleAndArchive(p.name);
                  }}
                  className="flex items-center gap-1.5 text-[10px] text-slate-600 hover:text-amber-400 transition-colors mt-1"
                >
                  <Archive size={10} /> Settle & Archive
                </button>
              )}

              {/* All-time attendance ring — bottom-right corner */}
              {attendancePct[p.name] !== undefined && (() => {
                const pct = attendancePct[p.name];
                const ringColor = pct >= 70 ? '#1D9E75' : pct >= 40 ? '#BA7517' : '#E24B4A';
                const size = 44, sw = 4, r = (size - sw) / 2 - 1;
                const circumference = 2 * Math.PI * r;
                const dash = (pct / 100) * circumference;
                return (
                  <div
                    className="absolute bottom-3 right-3 flex-shrink-0"
                    style={{ width: size, height: size }}
                    title={`All-time attendance: ${pct}%`}
                  >
                    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
                      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#383838" strokeWidth={sw} />
                      <circle
                        cx={size / 2} cy={size / 2} r={r} fill="none"
                        stroke={ringColor} strokeWidth={sw} strokeLinecap="round"
                        strokeDasharray={`${dash} ${circumference}`}
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-sky-400 tabular-nums">
                      {pct}
                    </span>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Archived players section */}
      {archivedPlayers.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowArchived(v => !v)}
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-400 mb-3 transition-colors"
          >
            <ArchiveRestore size={12} />
            Archived players ({archivedPlayers.length})
            <span className="text-slate-600">{showArchived ? '▲' : '▼'}</span>
          </button>
          {showArchived && (
            <div className="flex flex-col gap-2">
              {archivedPlayers.map(p => (
                <div key={p.name} style={AURORA_CARD_BG}
                  className="flex items-center justify-between rounded-2xl p-3 border border-slate-700/30 opacity-60">
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase">{p.name}</div>
                    <div className="text-[10px] text-slate-600">Balance: ${p.balance.toFixed(2)}</div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (!verifyAdminPin()) return;
                        handleUnarchivePlayer(p.name);
                      }}
                      className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1 border border-violet-700/30 px-2 py-1 rounded-lg transition-colors"
                    >
                      <ArchiveRestore size={10} /> Unarchive
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 text-center mt-6">
        Sorted A–Z · Long press to delete
      </div>
    </div>
  );
}