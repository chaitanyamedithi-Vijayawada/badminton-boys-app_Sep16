import { useState, useEffect,useMemo} from 'react';
import { DollarSign, ToggleLeft, ToggleRight, Send, AlertCircle, Lock, ShieldCheck, X, CheckCircle, Delete, Pencil, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { getWeekKey, getCompletedWeekKey, parseCourtSplit, courtSplitCourtHours, DEFAULT_COURT_SPLIT } from '../lib/constants';
import type { CourtSplit, CourtSplitSegment } from '../lib/constants';
import { getCurrentWeekKey, getCurrentWeekRange, isExtraSessionEnded, minutesSinceSessionEnd } from '../lib/cutoff';
import type { Day, Player, PlayerTransfer } from '../types';
import PlayerAvatar from '../components/PlayerAvatar';

import { notifyBroadcast, notifyTopUpConfirmed } from '../lib/notifications';

const TRANSFER_ALERT_STYLES = `
  @keyframes heartbeat {
    0%,100% { transform: scale(1); }
    14%      { transform: scale(1.04); }
    28%      { transform: scale(1); }
    42%      { transform: scale(1.04); }
    56%      { transform: scale(1); }
  }
  @keyframes borderRotate {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .transfer-alert-wrapper {
    padding: 2px;
    border-radius: 22px;
    background: linear-gradient(270deg, #7c5cff, #a855f7, #ec4899, #a855f7, #7c5cff);
    background-size: 300% 300%;
    animation: borderRotate 2s ease infinite, heartbeat 1.6s ease-in-out infinite;
    transform-origin: center;
    margin-bottom: 1rem;
  }
  .transfer-alert-inner {
    border-radius: 20px;
    overflow: hidden;
  }
`;

const EMERALD_GLOW = { boxShadow: '0 8px 24px rgba(80,40,140,0.45), inset 0 1px 0 rgba(255,255,255,0.07)', background:'linear-gradient(155deg,rgba(124,92,255,0.10),rgba(255,255,255,0.03) 45%,rgba(196,77,219,0.06))' };


function SplitCourtConfig({ day }: { day: Day }) {
  const { settings, loadSettings, showToast, ratePerCourt, verifyAdminPin } = useApp();

  const stored = parseCourtSplit(settings[`court_split_${day}`]);
  const [enabled, setEnabled] = useState<boolean>(stored?.enabled ?? false);
  const [segments, setSegments] = useState<CourtSplitSegment[]>(
    stored && stored.segments.length ? stored.segments : DEFAULT_COURT_SPLIT.segments
  );

  // Re-sync if settings are reloaded (e.g. after our own save or a realtime update).
  useEffect(() => {
    const s = parseCourtSplit(settings[`court_split_${day}`]);
    setEnabled(s?.enabled ?? false);
    if (s && s.segments.length) setSegments(s.segments);
  }, [settings, day]);

  const perHour = ratePerCourt / 2;
  const courtHours = courtSplitCourtHours({ enabled: true, segments });
  const total = courtHours * perHour;

  const persist = async (next: CourtSplit) => {
    await supabase.from('settings').upsert(
      { key: `court_split_${day}`, value: JSON.stringify(next) },
      { onConflict: 'key' }
    );
    await loadSettings();
  };

  const handleToggle = async () => {
    if (!verifyAdminPin()) return;
    const next = !enabled;
    setEnabled(next);
    await persist({ enabled: next, segments });
    showToast(next ? `${day} split-court ON` : `${day} split-court OFF — back to normal`);
  };

  const commit = async (segs: CourtSplitSegment[]) => {
    setSegments(segs);
    await persist({ enabled, segments: segs });
  };

  const setCourts = (i: number, courts: number) =>
    commit(segments.map((s, idx) => (idx === i ? { ...s, courts } : s)));
  const setHours = (i: number, hours: number) =>
    commit(segments.map((s, idx) => (idx === i ? { ...s, hours } : s)));
  const addSegment = () => commit([...segments, { courts: 1, hours: 1 }]);
  const removeSegment = (i: number) => {
    if (segments.length <= 1) return;
    commit(segments.filter((_, idx) => idx !== i));
  };

  return (
    <div className="bg-white/[0.05] border border-violet-400/10 rounded-xl p-3 mb-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-200 capitalize">{day} · split court</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Different courts per hour — turn on for this session, off after
          </div>
        </div>
        <button
          onClick={handleToggle}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
            enabled
              ? 'bg-amber-900/40 text-amber-400 border-amber-700/40'
              : 'bg-slate-800/60 text-slate-400 border-slate-700/50'
          }`}
        >
          {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          {enabled ? 'On' : 'Off'}
        </button>
      </div>

      {enabled && (
        <div className="mt-3 space-y-2">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 w-12">Block {i + 1}</span>
              <select
                value={seg.courts}
                onChange={e => setCourts(i, Number(e.target.value))}
                className="bg-slate-900/60 border border-slate-700/50 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none"
              >
                {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n} court{n !== 1 ? 's' : ''}</option>)}
              </select>
              <span className="text-[11px] text-slate-500">for</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={seg.hours}
                onChange={e => setHours(i, Number(e.target.value))}
                className="w-16 bg-slate-900/60 border border-slate-700/50 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none"
              />
              <span className="text-[11px] text-slate-500">hr</span>
              {segments.length > 1 && (
                <button onClick={() => removeSegment(i)} className="ml-auto text-red-400/60 hover:text-red-400 p-1">
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addSegment}
            className="text-xs text-violet-400 hover:text-violet-300 font-medium"
          >
            + Add another block
          </button>
          <div className="mt-2 pt-2 border-t border-slate-700/40 flex items-center justify-between text-xs">
            <span className="text-slate-400">{courtHours} court-hours @ ${perHour.toFixed(2)}/hr</span>
            <span className="text-violet-300 font-semibold">Total: ${total.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function VotingLockToggle({ day }: { day: Day }) {
  const { settings, loadSettings, showToast } = useApp();
  const isLocked = settings[`voting_locked_${day}`] === 'true';

  const toggle = async () => {
    const newVal = !isLocked;
    await supabase.from('settings').upsert(
      { key: `voting_locked_${day}`, value: String(newVal) },
      { onConflict: 'key' }
    );
    await loadSettings();
    showToast(newVal ? `${day} voting locked 🔒` : `${day} voting unlocked 🔓`);
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: isLocked ? 'rgba(251,191,36,0.08)' : 'rgba(15,23,42,0.5)',
      border: `1px solid ${isLocked ? 'rgba(251,191,36,0.3)' : 'rgba(30,41,59,0.8)'}`,
      borderRadius: 12,
      padding: '12px 16px',
      marginBottom: 8,
      transition: 'all 0.3s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>{isLocked ? '🔒' : '🔓'}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: isLocked ? '#fbbf24' : '#94a3b8', textTransform: 'capitalize' }}>
            {day} voting
          </div>
          <div style={{ fontSize: 11, color: '#55556a', marginTop: 2 }}>
            {isLocked ? 'Players cannot vote' : 'Players can vote freely'}
          </div>
        </div>
      </div>
      <button
        onClick={toggle}
        style={{
          padding: '6px 16px',
          borderRadius: 8,
          border: 'none',
          background: isLocked ? '#fbbf24' : '#1e293b',
          color: isLocked ? '#94a3b8' : '#94a3b8',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {isLocked ? 'Unlock' : 'Lock'}
      </button>
    </div>
  );
}

function PendingPayments() {
  const { pendingPayments, loadPendingPayments, myName, showToast, players, loadWallets } = useApp();

  const handleConfirm = async (id: number, playerName: string, amount: number) => {
    const targetPlayer = players.find(p => p.name === playerName);
    if (!targetPlayer) { showToast('Error: Resolved player profile missing'); return; }
    const oldBalance = targetPlayer.balance;
    const newBalance = oldBalance + amount;
    await supabase.from('payments').update({ status: 'confirmed', confirmed_by: myName, confirmed_at: new Date().toISOString() }).eq('id', id);
    await supabase.from('transactions').insert({ player_id: targetPlayer.id, type: 'top_up', amount: amount, note: `Payment Deposit Confirmed by Admin · balance $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)}` });
    await loadPendingPayments();
    await loadWallets();
    if (targetPlayer.email) {
      const emailed = await notifyTopUpConfirmed({
        to: targetPlayer.email,
        playerName,
        amount,
        oldBalance,
        newBalance,
        confirmedBy: myName || 'Admin',
      });
      showToast(
        emailed
          ? `Payment confirmed for ${playerName} · email sent ✓`
          : `Payment confirmed for ${playerName} · email failed (check Resend)`
      );
    } else {
      showToast(`Payment confirmed for ${playerName} · no email on file`);
    }
  };

  const handleReject = async (id: number, playerName: string) => {
    await supabase.from('payments').update({ status: 'rejected', confirmed_by: myName }).eq('id', id);
    await loadPendingPayments();
    showToast(`Payment rejected for ${playerName}`);
  };

  if (pendingPayments.length === 0) return (
    <div className="neon-card mb-4">
      <div className="text-sm font-semibold text-slate-200 mb-2">Pending Payments</div>
      <div className="text-sm text-slate-500 text-center py-2">No pending payments</div>
    </div>
  );

  return (
    <div className="neon-card mb-4">
      <div className="text-sm font-semibold text-slate-200 mb-3">Pending Payments ({pendingPayments.length})</div>
      <div className="flex flex-col gap-2">
        {pendingPayments.map(p => (
          <div key={p.id} className="bg-white/[0.05] border border-violet-400/10 rounded-xl p-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-100">{p.player_name}</div>
              <div className="text-xs text-slate-400">${Number(p.amount).toFixed(2)} · {new Date(p.created_at).toLocaleDateString()}</div>
            </div>
            <button onClick={() => handleReject(p.id, p.player_name)} className="text-xs px-2.5 py-1.5 rounded-lg bg-red-900/40 text-red-400 border border-red-700/30 font-medium">Reject</button>
            <button onClick={() => handleConfirm(p.id, p.player_name, Number(p.amount))} className="text-xs px-2.5 py-1.5 rounded-lg bg-violet-600 text-white font-medium">Confirm</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransferHistory({ transfers, players }: { transfers: PlayerTransfer[]; players: Player[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, PlayerTransfer[]>();
    transfers.forEach(t => {
      const d = new Date(t.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [transfers]);

  const [openMonth, setOpenMonth] = useState<string | null>(null);

  if (grouped.length === 0) return null;

  return (
    <div className="mt-2">
      <div style={{ fontSize: 10 }} className="text-slate-500 mb-1.5">Transfer History</div>
      <div className="flex flex-col gap-1.5">
        {grouped.map(([key, items]) => {
          const [yr, mo] = key.split('-');
          const date = new Date(Number(yr), Number(mo) - 1, 1);
          const label = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
          const isOpen = openMonth === key;
          const monthTotal = items.reduce((s, t) => s + Number(t.amount), 0);

          return (
            <div key={key} className="rounded-lg border border-white/[0.06] overflow-hidden">
              <button
                onClick={() => setOpenMonth(isOpen ? null : key)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
              >
                <ChevronDown
                  size={14}
                  className="text-slate-500 flex-shrink-0 transition-transform"
                  style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
                <span className="text-slate-300 font-semibold flex-1 text-left" style={{ fontSize: 12 }}>{label}</span>
                <span className="text-slate-500" style={{ fontSize: 11 }}>{items.length} txns</span>
                <span className="text-slate-400 tabular-nums" style={{ fontSize: 11 }}>${monthTotal.toFixed(2)}</span>
              </button>
              {isOpen && (
                <div className="flex flex-col">
                  {items.map(t => {
                    const tplayer = players.find(p => p.name === t.player_name);
                    return (
                      <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 border-t border-white/[0.04]" style={{ fontSize: 11 }}>
                        <PlayerAvatar player={tplayer} size={20} />
                        <span className="text-slate-300 flex-1">{t.player_name}</span>
                        <span className="text-slate-400">${Number(t.amount).toFixed(2)}</span>
                        <span
                          className="font-medium px-1.5 py-0.5 rounded"
                          style={{
                            fontSize: 10,
                            background: t.status === 'confirmed' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                            color: t.status === 'confirmed' ? '#34d399' : '#f87171',
                          }}
                        >
                          {t.status}
                        </span>
                        <span className="text-slate-600" style={{ fontSize: 10 }}>
                          {new Date(t.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PendingTransfers() {
  const { playerTransfers, loadPlayerTransfers, myName, showToast, players, loadWallets } = useApp();

  const pendingTransfers = playerTransfers.filter(t => t.status === 'pending');
  const recentTransfers = playerTransfers.filter(t => t.status !== 'pending');
  const hasAlert = pendingTransfers.length > 0;

  const handleConfirmTransfer = async (id: number, playerName: string, amount: number) => {
    const targetPlayer = players.find(p => p.name === playerName);
    if (!targetPlayer) { showToast('Error: Target profile identity resolution missed'); return; }
    const oldBalance = targetPlayer.balance;
    const newBalance = oldBalance + amount;
    await supabase.from('player_transfers').update({ status: 'confirmed', confirmed_by: myName, confirmed_at: new Date().toISOString() }).eq('id', id);
    await supabase.from('transactions').insert({ player_id: targetPlayer.id, type: 'top_up', amount: amount, note: `Transfer Deposit Confirmed by Admin · balance $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)}` });
    await loadPlayerTransfers();
    await loadWallets();
    if (targetPlayer.email) {
      const emailed = await notifyTopUpConfirmed({
        to: targetPlayer.email,
        playerName,
        amount,
        oldBalance,
        newBalance,
        confirmedBy: myName || 'Admin',
      });
      showToast(
        emailed
          ? `$${amount.toFixed(2)} transfer confirmed for ${playerName} · email sent ✓`
          : `$${amount.toFixed(2)} confirmed for ${playerName} · email failed (check Resend)`
      );
    } else {
      showToast(`$${amount.toFixed(2)} transfer confirmed for ${playerName} · no email on file`);
    }
  };

  const handleRejectTransfer = async (id: number, playerName: string) => {
    await supabase.from('player_transfers').update({ status: 'rejected', confirmed_by: myName }).eq('id', id);
    await loadPlayerTransfers();
    showToast(`Transfer rejected for ${playerName}`);
  };

  const cardContent = (
    <div className="neon-card" style={{ background:'linear-gradient(155deg,rgba(124,92,255,0.12),rgba(255,255,255,0.03) 45%,rgba(196,77,219,0.07))', border:'1px solid rgba(124,92,255,0.20)', borderRadius:'20px', boxShadow:'0 8px 24px rgba(80,40,140,0.4)', marginBottom: hasAlert ? 0 : '1rem' }}>
      <div style={{ padding: '14px 16px' }}>
        <div className="flex items-center gap-2 mb-2.5">
          <DollarSign size={13} className="text-violet-400" />
          <span style={{ fontSize: 12, fontWeight: 600 }} className="text-slate-200">Player Transfers</span>
          {hasAlert && (
            <span className="ml-auto bg-red-900/50 text-red-400 font-bold px-2 py-0.5 rounded-full" style={{ fontSize: 10 }}>
              {pendingTransfers.length} pending
            </span>
          )}
        </div>
        {!hasAlert && <div style={{ fontSize: 11 }} className="text-slate-500 text-center py-1.5">No pending transfers</div>}
        {pendingTransfers.map(t => {
          const tplayer = players.find(p => p.name === t.player_name);
          return (
          <div key={t.id} className="bg-amber-900/20 border border-amber-700/30 rounded-xl flex items-center gap-2 mb-2" style={{ padding: '8px 10px' }}>
            <PlayerAvatar player={tplayer} size={26} />
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 11, fontWeight: 500 }} className="text-slate-100">{t.player_name}</div>
              <div style={{ fontSize: 10 }} className="text-slate-400">${Number(t.amount).toFixed(2)} via {t.method} to {t.recipient} · {new Date(t.created_at).toLocaleDateString()}</div>
            </div>
            <button onClick={() => handleRejectTransfer(t.id, t.player_name)} className="rounded-lg bg-red-900/40 text-red-400 border border-red-700/30 font-medium" style={{ fontSize: 10, padding: '4px 8px' }}>Reject</button>
            <button onClick={() => handleConfirmTransfer(t.id, t.player_name, Number(t.amount))} className="rounded-lg bg-violet-600 text-white font-medium" style={{ fontSize: 10, padding: '4px 8px' }}>Confirm</button>
          </div>
          );
        })}
        {recentTransfers.length > 0 && (
          <TransferHistory transfers={recentTransfers} players={players} />
        )}
      </div>
    </div>
  );

  return (
    <>
      <style>{TRANSFER_ALERT_STYLES}</style>
      {hasAlert ? (
        <div className="transfer-alert-wrapper"><div className="transfer-alert-inner">{cardContent}</div></div>
      ) : cardContent}
    </>
  );
}

function AllBalances() {
  const { players, resetPlayerPin, verifyAdminPin, showToast } = useApp();
  const sorted = useMemo(() => [...players].sort((a, b) => a.balance - b.balance), [players]);

  return (
    <div className="neon-card card-rose mb-4">
      <div className="text-sm font-semibold text-slate-200 mb-3">All Balances</div>
      <div className="flex flex-col gap-1.5">
        {sorted.map(p => {
          const isLow = p.balance < 15;
          const isArun = p.name === 'Arun';
          return (
            <div key={p.name} className="flex items-center gap-2">
              <PlayerAvatar player={p} size={28} />
              <div className="flex-1 flex flex-col">
                <span className="text-sm text-slate-300">{p.name}</span>
                {isArun && p.balance > 0 && <span className="text-[10px] text-violet-400 font-medium">Reimbursed via Credit</span>}
              </div>
              <span className={`text-sm font-bold ${isLow ? 'text-red-400' : 'text-emerald-400'}`}>${p.balance.toFixed(2)}</span>
              {isLow && <AlertCircle size={12} className="text-red-400" />}
              <button
                onClick={async () => {
                  if (!verifyAdminPin()) return;
                  if (!window.confirm(`Reset PIN for ${p.name}? They will need to set a new PIN on next login.`)) return;
                  if (p.id) await resetPlayerPin(p.id);
                  showToast(`${p.name}'s PIN reset ✓`);
                }}
                className="text-xs text-slate-600 hover:text-red-400 transition-colors ml-1"
                title={`Reset ${p.name}'s PIN`}
              >
                🔑
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateExtraSession() {
  const { extraSessions, loadExtraSessions, showToast, verifyAdminPin } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', session_date: '', start_time: '', end_time: '', courts: [] as number[], cutoff_time: '' });
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const activeSessions = extraSessions.filter(s => {
    return !s.cancelled && !isExtraSessionEnded(s.session_date, s.end_time);
  });

  const toggleCourt = (n: number) => {
    setForm(f => ({ ...f, courts: f.courts.includes(n) ? f.courts.filter(c => c !== n) : [...f.courts, n].sort((a, b) => a - b) }));
  };

  const handleCreate = async () => {
    if (!verifyAdminPin()) return;
    if (!form.title || !form.session_date || !form.start_time || !form.end_time) { showToast('Please fill all required fields'); return; }
    if (form.courts.length === 0) { showToast('Please select at least one court'); return; }
    // No hard limit on extra sessions
    await supabase.from('extra_sessions').insert({ title: form.title, session_date: form.session_date, start_time: form.start_time, end_time: form.end_time, courts: form.courts, cutoff_time: form.cutoff_time || null, created_by: 'Admin' });
    await loadExtraSessions();
    setShowForm(false);
    setForm({ title: '', session_date: '', start_time: '', end_time: '', courts: [], cutoff_time: '' });
    showToast('Extra session created! ✓');
  };

  const handleDelete = async (id: number) => {
    if (!verifyAdminPin()) return;
    if (!window.confirm('Delete this session?')) return;
    await supabase.from('extra_sessions').delete().eq('id', id);
    await loadExtraSessions();
    showToast('Session deleted ✓');
  };

  const handleRename = async (id: number) => {
    const v = renameValue.trim();
    if (!v) { setRenamingId(null); return; }
    await supabase.from('extra_sessions').update({ title: v }).eq('id', id);
    await loadExtraSessions();
    setRenamingId(null);
    showToast('Session renamed ✓');
  };

  return (
    <div className="neon-card card-amber mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">📅</span>
        <span className="text-sm font-semibold text-slate-200">Extra Sessions</span>
        <span className="text-xs text-slate-500 ml-auto">{activeSessions.length} active</span>
      </div>
      {activeSessions.map(s => (
        <div key={s.id} style={{ background: '#1e1e30', border: '1px solid #252538', borderRadius: 12, padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="flex-1 min-w-0">
            {renamingId === s.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => handleRename(s.id)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(s.id); if (e.key === 'Escape') setRenamingId(null); }}
                className="w-full bg-white/[0.06] border border-violet-400/30 rounded-lg px-2 py-1 text-sm text-slate-100 focus:outline-none mb-1"
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="text-sm font-medium text-slate-200">{s.title}</div>
                <button
                  onClick={() => { setRenamingId(s.id); setRenameValue(s.title); }}
                  className="text-slate-600 hover:text-violet-400 transition-colors"
                >
                  <Pencil size={11} />
                </button>
              </div>
            )}
            <div className="text-xs text-slate-500">{new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {s.start_time} – {s.end_time}</div>
            <div className="flex gap-1 mt-1 flex-wrap">
              {s.courts.map(c => <span key={c} className="text-xs bg-purple-900/30 text-purple-400 px-2 py-0.5 rounded-full border border-purple-700/30">Court {c}</span>)}
            </div>
          </div>
          <button onClick={() => handleDelete(s.id)} className="text-red-400/50 hover:text-red-400 transition-colors p-1"><X size={14} /></button>
        </div>
      ))}
      {showForm ? (
        <div className="bg-slate-800/50 rounded-xl p-4 space-y-3">
          <div className="text-xs font-medium text-slate-300 mb-1">New Extra Session</div>
          <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Session title (e.g. Sunday Special)" className="w-full bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-violet-500" />
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Date</label>
            <input type="date" value={form.session_date} onChange={e => setForm(f => ({ ...f, session_date: e.target.value }))} className="w-full bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Start time</label>
              <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className="w-full bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">End time</label>
              <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} className="w-full bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Courts</label>
            <div className="flex gap-1.5 flex-wrap">
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} onClick={() => toggleCourt(n)} className={`w-9 h-9 rounded-lg text-sm font-semibold border transition-all ${form.courts.includes(n) ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-900/60 border-slate-700/60 text-slate-400'}`}>{n}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-lg bg-slate-700/50 text-slate-300 text-sm border border-slate-600/40">Cancel</button>
            <button onClick={handleCreate} className="flex-1 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold">Create Session</button>
          </div>
        </div>
      ) : (
        <button onClick={() => { if (!verifyAdminPin()) return; setShowForm(true); }}  className="w-full py-2.5 rounded-xl border border-dashed border-purple-700/40 text-purple-400 text-sm font-medium hover:border-purple-500/60 transition-colors">+ Create Extra Session</button>
      )}
    </div>
  );
}

function PinLockScreen() {
  const { submitPin } = useApp();
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);

  const handleDigit = (d: string) => {
    if (pin.length >= 6) return;
    setPin(p => p + d);
  };

  const handleDelete = () => setPin(p => p.slice(0, -1));

  const handleSubmit = () => {
    if (!pin) return;
    const ok = submitPin(pin);
    if (!ok) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPin('');
    }
  };

  const PAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <div className="px-4 pt-10 pb-6 flex flex-col items-center justify-center min-h-[70vh]">
      <div className="flex justify-center mb-5">
        <div className="w-16 h-16 rounded-2xl bg-rose-900/30 border border-rose-700/30 flex items-center justify-center shadow-[0_0_24px_rgba(244,63,94,0.15)]">
          <Lock size={28} className="text-rose-400" />
        </div>
      </div>
      <h2 className="text-lg font-bold text-slate-100 mb-1">Admin Access</h2>
      <p className="text-sm text-slate-500 mb-6">Enter your PIN</p>
      <div className={`flex gap-3 mb-8 transition-all duration-150 ${shake ? 'translate-x-2' : ''}`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${i < pin.length ? 'bg-rose-400 border-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.5)]' : 'bg-transparent border-slate-600'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
        {PAD.map((key, i) => {
          if (key === '') return <div key={i} />;
          if (key === '⌫') return (
            <button
              key={i}
              onClick={handleDelete}
              style={EMERALD_GLOW}
              className="h-14 rounded-2xl bg-slate-800/60 border border-slate-700/40 text-slate-400 flex items-center justify-center active:scale-95 transition-transform"
            >
              <Delete size={18} />
            </button>
          );
          return (
            <button
              key={i}
              onClick={() => handleDigit(key)}
              style={EMERALD_GLOW}
              className="h-14 rounded-2xl bg-slate-800/60 border border-slate-700/40 text-slate-100 text-xl font-semibold active:scale-95 active:bg-slate-700/80 transition-all"
            >
              {key}
            </button>
          );
        })}
      </div>
      <button onClick={handleSubmit} disabled={pin.length === 0} className="mt-6 w-full max-w-[260px] flex items-center justify-center gap-2 bg-rose-600 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors shadow-[0_0_16px_rgba(244,63,94,0.2)]">
        <ShieldCheck size={18} />Unlock
      </button>
    </div>
  );
}

export default function AdminTab() {
  const { myName, settings, showToast, loadSettings, loadPendingPayments, loadPlayerTransfers, pinVerified, completedSessions, completeSession, completeExtraSession, extraSessions, players, logout, handleSendSessionEmails, handleSendExtraSessionEmails } = useApp();
  const [admin1, setAdmin1] = useState(settings.admin1 || 'Eswar');
  const [admin2, setAdmin2] = useState(settings.admin2 || 'Arun');
  const [payName, setPayName] = useState(settings.payment_recipient_name || 'Arun');
  const [payEmail, setPayEmail] = useState(settings.payment_recipient_email || 'arun.gedela@gmail.com');
  const [wedStart, setTueStart] = useState('6:00 PM');
  const [wedEnd, setTueEnd] = useState('8:00 PM');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [completing, setCompleting] = useState<'saturday' | 'wednesday' | null>(null);
  const [finalizingExtra, setFinalizingExtra] = useState<number | null>(null);
  const [emailingKey, setEmailingKey] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');

  useEffect(() => {
    if (pinVerified) { loadPendingPayments(); loadPlayerTransfers(); }
    try {
      const t = JSON.parse(settings.wed_time || '{}');
      if (t.start) setTueStart(t.start);
      if (t.end) setTueEnd(t.end);
    } catch { /* ignore */ }
    setAdmin1(settings.admin1 || 'Eswar');
    setAdmin2(settings.admin2 || 'Arun');
    setPayName(settings.payment_recipient_name || 'Arun');
    setPayEmail(settings.payment_recipient_email || 'arun.gedela@gmail.com');
  }, [settings, pinVerified]);

  if (!pinVerified) return <PinLockScreen />;

  const handleSaveAdmins = async () => {
    if (!admin1 || !admin2) { showToast('Both admin slots must be filled'); return; }
    if (admin1 === admin2) { showToast('Admin 1 and Admin 2 must be different players'); return; }
    const removingSelf = myName && ![admin1, admin2].includes(myName);
    if (removingSelf) {
      if (!window.confirm(`You are removing yourself as admin. You will lose admin access immediately after saving. Continue?`)) return;
    }
    await supabase.from('settings').upsert({ key: 'admin1', value: admin1 }, { onConflict: 'key' });
    await supabase.from('settings').upsert({ key: 'admin2', value: admin2 }, { onConflict: 'key' });
    await loadSettings();
    showToast('Admins updated!');
  };

  const handleSavePaymentRecipient = async () => {
    if (!payName.trim()) { showToast('Recipient name required'); return; }
    if (!payEmail.trim() || !payEmail.includes('@')) { showToast('Valid email required'); return; }
    const { error: nameErr } = await supabase.from('settings').upsert({ key: 'payment_recipient_name', value: payName.trim() }, { onConflict: 'key' });
    const { error: emailErr } = await supabase.from('settings').upsert({ key: 'payment_recipient_email', value: payEmail.trim() }, { onConflict: 'key' });
    if (nameErr || emailErr) { showToast(`Save failed: ${nameErr?.message || emailErr?.message || 'unknown'}`); return; }
    await loadSettings();
    showToast('Payment recipient updated!');
  };

  const handleSaveTueTime = async () => {
    const val = JSON.stringify({ start: wedStart, end: wedEnd });
    await supabase.from('settings').upsert({ key: 'wed_time', value: val }, { onConflict: 'key' });
    await loadSettings();
    showToast('Wednesday time updated!');
  };

  const handleBroadcastSend = async () => {
    const msg = broadcastMsg.trim();
    if (!msg) return;
    setBroadcasting(true);
    await supabase.from('broadcast_messages').insert({ content: msg, sent_by: myName || 'Admin' });
    await notifyBroadcast(msg, myName || 'Admin');
    setBroadcasting(false);
    setShowBroadcast(false);
    setBroadcastMsg('');
    showToast('Broadcast sent to all players!');
  };

  const handleCompleteSessionManual = async (day: Day) => {
    if (!window.confirm(`Force manual completion calculation for ${day} session?`)) return;
    setCompleting(day);
    try {
      await completeSession(day);
      showToast(`${day} finalized — use Send Session Emails below 📧`);
    }
    catch (err: unknown) { showToast(`Deduction calculation failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setCompleting(null); }
  };

  // Resend session emails any time — no time limit. Reuses the same handlers the
  // Home tab uses; this panel just keeps them permanently reachable for admins.
  const runResend = async (key: string, fn: () => Promise<void>) => {
    if (emailingKey) return;
    setEmailingKey(key);
    try { await fn(); } finally { setEmailingKey(null); }
  };

  // Only the CURRENT week's sessions (Pacific Mon–Sun). These stay available
  // through Sunday 11:59 PM Pacific, then clear when the new week begins Monday.
  const weekKey = getCurrentWeekKey();
  const latestSaturday = completedSessions.find(s => s.day === 'saturday' && !s.is_extra && s.week === weekKey);
  const latestWednesday = completedSessions.find(s => s.day === 'wednesday' && !s.is_extra && s.week === weekKey);

  const weekRange = getCurrentWeekRange();
  const finalizedExtraSessions = extraSessions
    .filter(s => s.auto_deducted && !s.cancelled && s.session_date >= weekRange.start && s.session_date <= weekRange.end)
    .sort((a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime());

  const fmtSessionDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return dateStr; }
  };

  const handleScheduleReminder = async () => {
    const week = getWeekKey();
    const msg = `Session reminder for week ${week}`;
    await supabase.from('broadcast_messages').insert({ content: msg, sent_by: myName || 'Admin' });
    await notifyBroadcast(msg, myName || 'Admin');
    showToast('Reminder sent!');
  };

  const handleChangePin = async () => {
    const pin = newPin.trim();
    if (!/^\d{4,8}$/.test(pin)) { showToast('PIN must be 4–8 digits'); return; }
    if (!window.confirm(`Change the admin PIN to ${pin}? You'll use this next time you unlock admin mode.`)) return;
    await supabase.from('settings').upsert({ key: 'admin_pin', value: pin }, { onConflict: 'key' });
    await loadSettings();
    setNewPin('');
    showToast('Admin PIN updated');
  };

  return (
    <div className="px-4 pt-4 pb-6">
      <PendingTransfers />

      {/* Finalize-ready reminder — shown when a regular Sat/Wed session ended
          more than 2 hours ago but hasn't been finalized (auto_deducted=true)
          yet. Prompts the admin to confirm with one tap. Never fires
          automatically; the admin must always be the one who commits money. */}
      {(() => {
        const weekKey = getCurrentWeekKey();
        const ready: { day: Day; label: string }[] = [];
        (['saturday', 'wednesday'] as Day[]).forEach(d => {
          const finalized = completedSessions.some(s =>
            s.day === d && !s.is_extra && s.week === weekKey
          );
          if (finalized) return;
          const wedEndHour = (() => {
            try {
              const t = JSON.parse(settings.wed_time || '{}');
              if (t.end) {
                const m = /(\d+):(\d+)\s*(AM|PM)?/i.exec(t.end);
                if (m) {
                  let h = parseInt(m[1], 10);
                  if (m[3] && m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
                  return h;
                }
              }
            } catch { /* ignore */ }
            return 20;
          })();
          const mins = minutesSinceSessionEnd(d, 9, wedEndHour);
          if (mins >= 120) {
            ready.push({
              day: d,
              label: d === 'saturday' ? 'Saturday' : 'Wednesday',
            });
          }
        });
        if (ready.length === 0) return null;
        return (
          <div className="neon-card mb-4" style={{ borderColor: 'rgba(245, 158, 11, 0.4)', background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.03))' }}>
            <div className="text-xs uppercase tracking-wide text-amber-400 font-semibold mb-2">
              Ready to finalize
            </div>
            <div className="text-[11px] text-slate-400 mb-3">
              {ready.length > 1 ? 'Sessions have' : 'Session has'} ended more than 2 hours ago. Tap to finalize and apply charges.
            </div>
            {ready.map(r => (
              <button
                key={r.day}
                disabled={completing === r.day}
                onClick={() => handleCompleteSessionManual(r.day)}
                className="w-full mb-2 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2"
              >
                {completing === r.day ? 'Finalizing…' : `✓ Finalize ${r.label} session`}
              </button>
            ))}
          </div>
        );
      })()}

      <CreateExtraSession />

{/* ── Finalize Extra Sessions ──────────────────────────────────── */}
{(() => {
  const pendingExtra = extraSessions.filter(s => {
    return isExtraSessionEnded(s.session_date, s.end_time) && !s.auto_deducted && !s.cancelled;
  });
  if (pendingExtra.length === 0) return null;
  return (
    <div className="neon-card card-purple mb-4" style={{ border: '1px solid rgba(168,85,247,0.3)' }}>
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle size={15} className="text-purple-400" />
        <span className="text-sm font-semibold text-slate-200">Finalize Extra Sessions</span>
      </div>
      <div className="text-xs text-slate-500 mb-3">
        These sessions have ended but fees have not been deducted yet. Tap Finalize to deduct fees and send emails.
      </div>
      {pendingExtra.map(s => (
        <div key={s.id} className="flex items-center justify-between bg-slate-800/50 rounded-xl px-4 py-3 mb-2">
          <div>
            <div className="text-sm font-medium text-slate-200">{s.title}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {s.start_time} – {s.end_time}
            </div>
          </div>
          <button
            onClick={async () => {
              if (!window.confirm(`Finalize "${s.title}" and deduct fees from all going players?`)) return;
              setFinalizingExtra(s.id);
              try { await completeExtraSession(s.id); }
              catch (err: unknown) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`); }
              finally { setFinalizingExtra(null); }
            }}
            disabled={finalizingExtra === s.id}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-700/60 hover:bg-purple-600/70 text-purple-200 font-semibold border border-purple-600/40 transition-colors disabled:opacity-50"
          >
            {finalizingExtra === s.id ? 'Finalizing...' : 'Finalize'}
          </button>
        </div>
      ))}
    </div>
  );
})()}

      {/* ── Send Session Emails (always available — no time limit) ──────── */}
      {(latestSaturday || latestWednesday || finalizedExtraSessions.length > 0) && (
        <div className="neon-card card-cyan mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Send size={15} className="text-violet-400" />
            <span className="text-sm font-semibold text-slate-200">Send Session Emails</span>
            <span className="ml-auto text-[10px] text-slate-500">any time</span>
          </div>
          <div className="text-xs text-slate-500 mb-3">
            Re-send the recap email to all players who have an email saved. Works any time after a session — including extra sessions.
          </div>
          <div className="flex flex-col gap-2">
            {latestSaturday && (
              <button
                disabled={emailingKey !== null}
                onClick={() => runResend('saturday', () => handleSendSessionEmails('saturday'))}
                className="w-full py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/40 text-slate-200 text-sm font-medium hover:bg-slate-700/50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {emailingKey === 'saturday' ? 'Sending…' : `📧 Saturday session${latestSaturday.session_date ? ` · ${fmtSessionDate(latestSaturday.session_date)}` : ''}`}
              </button>
            )}
            {latestWednesday && (
              <button
                disabled={emailingKey !== null}
                onClick={() => runResend('wednesday', () => handleSendSessionEmails('wednesday'))}
                className="w-full py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/40 text-slate-200 text-sm font-medium hover:bg-slate-700/50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {emailingKey === 'wednesday' ? 'Sending…' : `📧 Wednesday session${latestWednesday.session_date ? ` · ${fmtSessionDate(latestWednesday.session_date)}` : ''}`}
              </button>
            )}
            {finalizedExtraSessions.map(s => (
              <button
                key={s.id}
                disabled={emailingKey !== null}
                onClick={() => runResend(`extra-${s.id}`, () => handleSendExtraSessionEmails(s.id))}
                className="w-full py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/40 text-slate-200 text-sm font-medium hover:bg-slate-700/50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {emailingKey === `extra-${s.id}`
                  ? 'Sending…'
                  : `📧 ${s.title || 'Extra session'}${s.session_date ? ` · ${fmtSessionDate(s.session_date)}` : ''}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="neon-card card-amber mb-4">
        <div className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2"><span>🔒</span> Voting Control</div>
        <VotingLockToggle day="saturday" />
        <VotingLockToggle day="wednesday" />
      </div>
      <div className="neon-card card-sky mb-4">
        <div className="text-sm font-semibold text-slate-200 mb-3">Court Management</div>
        <div className="text-[11px] text-slate-500 mb-3 bg-white/[0.03] border border-white/[0.06] rounded-lg p-2">
          Courts open automatically as players vote — 1 court per 4 voters (max 4 courts, 20 accepted).
          Extra attendees join the waitlist and auto-promote when a court opens or someone drops.
        </div>
        <SplitCourtConfig day="saturday" />
        <SplitCourtConfig day="wednesday" />
      </div>
      <div className="neon-card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle size={15} className="text-violet-400" />
          <span className="text-sm font-semibold text-slate-200">Complete Session</span>
        </div>
        <div className="text-xs text-slate-500 mb-3">Manually complete a session, deduct fees, and send emails to all players. Use this if auto-completion didn't trigger.</div>
        {(['saturday', 'wednesday'] as const).map(day => {
          const week = getCompletedWeekKey();
          const done = completedSessions.some(s => s.week === week && s.day === day);
          return (
            <div key={day} className="flex items-center justify-between bg-slate-800/50 rounded-xl px-4 py-3 mb-2">
              <div>
                <div className="text-sm font-medium text-slate-200 capitalize">{day}</div>
                <div className="text-xs text-slate-500 mt-0.5">{done ? 'Already completed this week' : 'Not yet completed'}</div>
              </div>
              {done ? (
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold"><CheckCircle size={14} /> Done</div>
              ) : (
                <button onClick={() => handleCompleteSessionManual(day)} disabled={completing === day} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700/60 hover:bg-emerald-600/70 text-emerald-200 font-semibold border border-emerald-600/40 transition-colors disabled:opacity-50">
                  {completing === day ? 'Completing...' : 'Complete'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="neon-card card-lime mb-4">
        <div className="text-sm font-semibold text-slate-200 mb-3">Wednesday Session Time</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input type="text" value={wedStart} onChange={e => setTueStart(e.target.value)} placeholder="Start" className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500" />
          <input type="text" value={wedEnd} onChange={e => setTueEnd(e.target.value)} placeholder="End" className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500" />
        </div>
        <button onClick={handleSaveTueTime} className="w-full bg-slate-800/60 hover:bg-slate-700/60 text-slate-100 rounded-xl py-2 text-sm font-semibold transition-colors border border-slate-700/40">Save Time</button>
      </div>
      <div className="neon-card card-rose mb-4">
        <div className="text-sm font-semibold text-slate-200 mb-3">Admin Names</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select value={admin1} onChange={e => setAdmin1(e.target.value)} className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none">
            <option value="">Select Admin 1</option>
            {players.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <select value={admin2} onChange={e => setAdmin2(e.target.value)} className="w-full bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none">
            <option value="">Select Admin 2</option>
            {players.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={handleSaveAdmins} className="w-full bg-slate-800/60 hover:bg-slate-700/60 text-slate-100 rounded-xl py-2 text-sm font-semibold transition-colors border border-slate-700/40">Save Admins</button>
      </div>
      <div className="neon-card card-rose mb-4">
        <div className="text-sm font-semibold text-slate-200 mb-1 flex items-center gap-2"><Lock size={14} className="text-rose-400" /> Admin PIN</div>
        <p className="text-[11px] text-slate-500 mb-3">Stored in the database so it survives every deploy. Use 4–8 digits.</p>
        <div className="flex gap-2">
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
            placeholder="New PIN"
            maxLength={8}
            className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500/50"
          />
          <button onClick={handleChangePin} disabled={!newPin.trim()} className="px-4 rounded-xl bg-rose-700/60 hover:bg-rose-600/70 disabled:opacity-40 text-rose-100 text-sm font-semibold border border-rose-600/40 transition-colors">Update</button>
        </div>
      </div>
      <div className="neon-card card-cyan mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-slate-200">💵 Payment Recipient</span>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">Who players send Interac e-Transfers to. Shown on the Home tab top-up screen.</p>
        <label className="text-[11px] text-slate-400 block mb-1">Name</label>
        <input
          value={payName}
          onChange={e => setPayName(e.target.value)}
          placeholder="Recipient name"
          className="w-full bg-slate-800/60 border border-slate-700/40 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none mb-2"
        />
        <label className="text-[11px] text-slate-400 block mb-1">Interac email</label>
        <input
          value={payEmail}
          onChange={e => setPayEmail(e.target.value)}
          placeholder="email@example.com"
          inputMode="email"
          className="w-full bg-slate-800/60 border border-slate-700/40 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none mb-3"
        />
        <button onClick={handleSavePaymentRecipient} className="w-full bg-slate-800/60 hover:bg-slate-700/60 text-slate-100 rounded-xl py-2 text-sm font-semibold transition-colors border border-slate-700/40">Save Recipient</button>
      </div>
      <div className="neon-card card-cyan mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Send size={16} className="text-violet-400" />
          <span className="text-sm font-semibold text-slate-200">Notifications</span>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={handleScheduleReminder} className="w-full bg-slate-800/50 border border-slate-700/40 text-slate-200 rounded-xl py-2.5 text-sm font-medium text-left px-4 hover:bg-slate-700/50 transition-colors">Schedule Session Reminder</button>
          <button onClick={() => setShowBroadcast(v => !v)} className="w-full bg-slate-800/50 border border-slate-700/40 text-slate-200 rounded-xl py-2.5 text-sm font-medium text-left px-4 hover:bg-slate-700/50 transition-colors">Broadcast Message</button>
          {showBroadcast && (
            <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-3 space-y-2">
              <textarea value={broadcastMsg} onChange={e => setBroadcastMsg(e.target.value)} placeholder="Type your message..." rows={3} className="w-full bg-slate-800/60 border border-slate-700/40 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-none" />
              <div className="flex gap-2">
                <button onClick={() => { setShowBroadcast(false); setBroadcastMsg(''); }} className="flex-1 py-2 rounded-lg bg-slate-700/50 text-slate-300 text-sm border border-slate-600/40">Cancel</button>
                <button onClick={handleBroadcastSend} disabled={!broadcastMsg.trim() || broadcasting} className="flex-1 py-2 rounded-lg bg-violet-600 disabled:opacity-40 text-white text-sm font-semibold flex items-center justify-center gap-1.5"><Send size={14} />{broadcasting ? 'Sending...' : 'Send'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <PendingPayments />
      <AllBalances />
      <button
        onClick={() => {
          if (!window.confirm('Log out?')) return;
          logout();
        }}
        className="w-full py-3 rounded-xl border border-red-900/40 text-red-400 text-sm font-semibold hover:bg-red-900/20 transition-colors mt-2"
      >
        Log Out
      </button>
    </div>
  );
}
