import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
// FeesTab.tsx and HomeTab.tsx — change back to:
import { useFunds } from '../hooks/useFunds';

// ── Types ────────────────────────────────────────────────────────────────────

interface PlayerBalance {
  id: string;
  name: string;
  balance: number;
}

interface CourtHours {
  purchased: number;
  used: number;
  remaining: number;
}

interface PendingSession {
  id: string;
  session_date: string;
  players_count: number;
  per_person: number;
  total_cost: number;
}

interface MiscCharge {
  id: string;
  note?: string;
  created_at: string;
  per_player_amount: number;
  total_amount: number;
}

interface CourtPaymentEntry {
  id: string;
  note?: string;
  paid_at: string;
  hours_purchased: number;
  amount: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  created_at: string;
  note?: string;
  session_id?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (d: string): string => {
  // Date-only strings (YYYY-MM-DD) get parsed as UTC midnight by `new Date()`,
  // which shifts back a day in Pacific time. Parse the components directly
  // for date-only strings to avoid this; full timestamps still parse normally.
  const dateOnlyMatch = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, y, m, day] = dateOnlyMatch;
    return new Date(Number(y), Number(m) - 1, Number(day)).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }
  return new Date(d).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
};

const LABELS: Record<string, string> = {
  top_up:       'Top-Up',
  match_charge: 'Match Charge',
  misc_charge:  'Misc Charge',
  adjustment:   'Charge Adjustment',
};

const TX_COLOR: Record<string, string> = {
  top_up:       'text-violet-400',
  match_charge: 'text-red-400',
  misc_charge:  'text-orange-400',
  adjustment:   'text-yellow-400',
};

const balColor  = (n: number): string => (n >= 0 ? 'text-violet-400' : 'text-red-400');
const fmtAmt    = (n: number): string => (n >= 0 ? `$${Number(n).toFixed(2)}` : `-$${Math.abs(Number(n)).toFixed(2)}`);
const fmtSigned = (n: number): string => (n >= 0 ? `+$${Number(n).toFixed(2)}` : `-$${Math.abs(Number(n)).toFixed(2)}`);
const fmtHrs    = (n: number): string => `${Number(n).toFixed(1)} hrs`;

// ── Primitive UI components ───────────────────────────────────────────────────

interface CardProps { children: React.ReactNode; className?: string; }
function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`backdrop-blur-sm border border-violet-400/15 rounded-xl p-4 ${className}`}
      style={{ background:'linear-gradient(155deg,rgba(124,92,255,0.09),rgba(255,255,255,0.02) 45%,rgba(196,77,219,0.05))', animation: 'cardGlowPulse 4s ease-in-out infinite' }}
    >
      {children}
    </div>
  );
}

interface SectionTitleProps { title: string; }
function SectionTitle({ title }: SectionTitleProps) {
  return (
    <h3 className="text-violet-400 font-semibold text-xs uppercase tracking-widest mb-3">
      {title}
    </h3>
  );
}

interface FieldProps {
  label?: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}
function Field({ label, type = 'text', value, onChange, placeholder }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs text-gray-400">{label}</label>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-white/5 border border-violet-400/20 rounded-lg px-3 py-2 text-white
                   text-sm focus:outline-none focus:border-violet-400 transition-colors"
      />
    </div>
  );
}

type BtnVariant = 'primary' | 'ghost' | 'danger';
type BtnSize = 'sm' | 'md';
interface BtnProps {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  variant?: BtnVariant;
  size?: BtnSize;
}
function Btn({ onClick, children, disabled, variant = 'primary', size = 'md' }: BtnProps) {
  const base = 'rounded-lg font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const sizes: Record<BtnSize, string> = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' };
  const vars: Record<BtnVariant, string> = {
    primary: 'bg-violet-500 text-black hover:bg-violet-400',
    ghost:   'border border-gray-600 text-gray-300 hover:border-violet-400 hover:text-violet-400',
    danger:  'bg-red-600 text-white hover:bg-red-500',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${base} ${sizes[size]} ${vars[variant]}`}>
      {children}
    </button>
  );
}

function Divider() {
  return <div className="border-b border-gray-800" />;
}

// ── Feature components ────────────────────────────────────────────────────────

interface CourtHoursCardProps {
  courtHours: CourtHours;
  threshold: number;
  showAlert: boolean;
}
function CourtHoursCard({ courtHours, threshold, showAlert }: CourtHoursCardProps) {
  const { purchased, used, remaining } = courtHours;
  const isLow = remaining < threshold;
  return (
    <Card className={showAlert && isLow ? 'border-orange-700' : ''}>
      <SectionTitle title="Court Hours" />
      {showAlert && isLow && (
        <div className="flex items-center gap-2 bg-orange-950 border border-orange-700
                        rounded-lg px-3 py-2 mb-3">
          <span className="text-orange-400 text-sm">⚠</span>
          <p className="text-orange-400 text-xs font-medium">
            Court hours low: {fmtHrs(remaining)} remaining (threshold: {threshold} hrs)
          </p>
        </div>
      )}
      {purchased > 0 && (
        <div className="flex justify-center mb-3">
          <div className="relative" style={{ width: 200, height: 112 }}>
            <svg width="200" height="112" viewBox="0 0 200 112">
              <defs>
                <linearGradient id="courtGauge" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#ff6f91" />
                  <stop offset="1" stopColor="#7c5cff" />
                </linearGradient>
              </defs>
              <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="14" strokeLinecap="round" />
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke={isLow ? '#fb923c' : 'url(#courtGauge)'}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0, Math.min(1, remaining / purchased)) * 251.3} 251.3`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
              <span className={`text-2xl font-bold ${balColor(remaining)}`}>{fmtHrs(remaining)}</span>
              <span className="text-[10px] text-gray-500">remaining of {fmtHrs(purchased)}</span>
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/[0.05] border border-violet-400/10 rounded-lg p-3 text-center">
          <p className="text-gray-500 text-xs mb-1">Purchased</p>
          <p className="text-violet-400 text-xl font-bold">{fmtHrs(purchased)}</p>
        </div>
        <div className="bg-white/[0.05] border border-violet-400/10 rounded-lg p-3 text-center">
          <p className="text-gray-500 text-xs mb-1">Used</p>
          <p className="text-orange-400 text-xl font-bold">{fmtHrs(used)}</p>
        </div>
        <div className="bg-white/[0.05] border border-violet-400/10 rounded-lg p-3 text-center">
          <p className="text-gray-500 text-xs mb-1">Remaining</p>
          <p className={`text-xl font-bold ${balColor(remaining)}`}>{fmtHrs(remaining)}</p>
        </div>
      </div>
    </Card>
  );
}

interface TopUpModalProps {
  player: PlayerBalance;
  onConfirm: (id: string, amount: number, note: string) => Promise<void>;
  onClose: () => void;
}
function TopUpModal({ player, onConfirm, onClose }: TopUpModalProps) {
  const [amount, setAmount] = useState('');
  const [note, setNote]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  const handleSubmit = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return setErr('Enter a valid positive amount');
    setBusy(true); setErr('');
    try {
      await onConfirm(player.id, val, note.trim());
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="backdrop-blur-sm border border-violet-400/20 rounded-xl p-6 w-full max-w-sm flex flex-col gap-4" style={{background:"linear-gradient(155deg,rgba(124,92,255,0.12),rgba(255,255,255,0.03) 45%,rgba(196,77,219,0.07))"}}>
        <div>
          <h2 className="text-white font-semibold text-lg">Top Up</h2>
          <p className="text-gray-400 text-sm">{player.name}</p>
        </div>
        <Field label="Amount ($)" type="number" value={amount}
               onChange={setAmount} placeholder="0.00" />
        <Field label="Note (optional)" value={note}
               onChange={setNote} placeholder="e.g. Cash received" />
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <div className="flex gap-2 justify-end">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSubmit} disabled={busy}>
            {busy ? 'Saving…' : 'Confirm Top Up'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Fund Trend Chart ──────────────────────────────────────────────────────────
function FundTrendChart({ data }: { data: { date: string; balance: number }[] }) {
  if (data.length < 2) return null;
  const W = 320, H = 156, PAD = { t: 16, r: 12, b: 40, l: 58 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const balances = data.map(d => d.balance);
  const minB = Math.min(...balances);
  const maxB = Math.max(...balances);
  const range = maxB - minB || 1;
  const xScale = (i: number) => PAD.l + (i / (data.length - 1)) * iW;
  const yScale = (v: number) => PAD.t + iH - ((v - minB) / range) * iH;
  const pts = data.map((d, i) => `${xScale(i)},${yScale(d.balance)}`).join(' ');
  const area = `M ${xScale(0)},${yScale(data[0].balance)} L ${pts.split(' ').slice(1).join(' ')} L ${xScale(data.length - 1)},${PAD.t + iH} L ${xScale(0)},${PAD.t + iH} Z`;
  // X axis labels: first and last date
  const fmt = (d: string) => { const dt = new Date(d); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  // Y axis labels
  const yTicks = [minB, (minB + maxB) / 2, maxB];
  return (
    <div className="mt-3">
      <div className="text-xs text-slate-300 font-semibold mb-2">Fund balance trend</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="fundGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00d9ff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#7c5cff" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={yScale(v)} x2={W - PAD.r} y2={yScale(v)}
              stroke="rgba(255,255,255,0.10)" strokeWidth="1" strokeDasharray="3,3" />
            <text x={PAD.l - 6} y={yScale(v) + 4} textAnchor="end"
              fontSize="10" fontWeight="600" fill="#a8a8b8">
              {v < 0 ? `-$${Math.abs(Math.round(v))}` : `$${Math.round(v)}`}
            </text>
          </g>
        ))}
        {/* Zero line if visible */}
        {minB < 0 && maxB > 0 && (
          <line x1={PAD.l} y1={yScale(0)} x2={W - PAD.r} y2={yScale(0)}
            stroke="rgba(255,111,145,0.3)" strokeWidth="1" />
        )}
        {/* Area fill */}
        <path d={area} fill="url(#fundGrad)" />
        {/* Line */}
        <polyline points={pts} fill="none" stroke="#00d9ff" strokeWidth="2" strokeLinejoin="round" />
        {/* Last point dot */}
        <circle cx={xScale(data.length - 1)} cy={yScale(data[data.length - 1].balance)}
          r="3.5" fill="#00d9ff" />
        {/* X axis date labels */}
        <text x={xScale(0)} y={H - 22} textAnchor="middle" fontSize="10" fontWeight="600" fill="#a8a8b8">{fmt(data[0].date)}</text>
        <text x={xScale(data.length - 1)} y={H - 22} textAnchor="middle" fontSize="10" fontWeight="600" fill="#a8a8b8">{fmt(data[data.length - 1].date)}</text>
        {/* X axis title */}
        <text x={PAD.l + iW / 2} y={H - 6} textAnchor="middle" fontSize="9" fontWeight="500" fill="#777" letterSpacing="0.5">
          Date
        </text>
        {/* Y axis title (rotated) */}
        <text x={14} y={PAD.t + iH / 2} textAnchor="middle" fontSize="9" fontWeight="500" fill="#777" letterSpacing="0.5"
          transform={`rotate(-90, 14, ${PAD.t + iH / 2})`}>
          Balance ($)
        </text>
      </svg>
    </div>
  );
}

interface FundSummaryCardProps { fundBalance: number; fundTrend: { date: string; balance: number }[]; }
function FundSummaryCard({ fundBalance, fundTrend }: FundSummaryCardProps) {
  return (
    <Card>
      <SectionTitle title="Fund Summary" />
      <div className="text-center py-3">
        <p className="text-gray-400 text-xs mb-1">Total Fund Available</p>
        <p className={`text-5xl font-bold tracking-tight ${balColor(fundBalance)}`}>
          {fmtAmt(fundBalance)}
        </p>
        <p className="text-gray-600 text-xs mt-2">Sum of all player balances · always live</p>
      </div>
      <FundTrendChart data={fundTrend} />
    </Card>
  );
}

interface PlayerBalancesListProps {
  playerBalances: PlayerBalance[];
  onTopUp: (p: PlayerBalance) => void;
}
function PlayerBalancesList({ playerBalances, onTopUp }: PlayerBalancesListProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle title="Player Balances" />
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-xs text-gray-400 hover:text-violet-400 transition-colors border border-gray-700 hover:border-violet-700 px-2 py-1 rounded-lg"
        >
          {collapsed ? '▼ Show' : '▲ Hide'}
        </button>
      </div>
      {collapsed && (
        <p className="text-gray-500 text-xs text-center py-1">
          {playerBalances.length} players · tap Show to expand
        </p>
      )}
      {!collapsed && (
        <div className="flex flex-col">
          {playerBalances.map((p, i) => (
            <div key={p.id}>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-white text-sm font-medium">{p.name}</p>
                <p className={`text-xs font-semibold ${balColor(p.balance)}`}>
                  {fmtAmt(p.balance)}
                </p>
              </div>
              <Btn size="sm" variant="ghost" onClick={() => onTopUp(p)}>+ Top Up</Btn>
            </div>
            {i < playerBalances.length - 1 && <Divider />}
          </div>
        ))}
{playerBalances.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-4">No players found</p>
        )}
        </div>
      )}
    </Card>
  );
}

interface PendingSessionsSectionProps {
  pendingSessions: PendingSession[];
  onApply: (id: string) => Promise<void>;
}
function PendingSessionsSection({ pendingSessions, onApply }: PendingSessionsSectionProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr]   = useState('');

  const handleApply = async (sessionId: string) => {
    setBusy(sessionId); setErr('');
    try { await onApply(sessionId); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (pendingSessions.length === 0) return null;

  return (
    <Card className="border-orange-900">
      <SectionTitle title="⚠ Pending Match Charges" />
      <p className="text-gray-400 text-xs mb-3">
        These sessions have not had match charges applied yet.
      </p>
      {err && <p className="text-red-400 text-xs mb-2">{err}</p>}
      <div className="flex flex-col">
        {pendingSessions.map((s, i) => (
          <div key={s.id}>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-white text-sm font-medium">{fmtDate(s.session_date)}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {s.players_count} players · ${Number(s.per_person).toFixed(2)}/each
                  · Total ${Number(s.total_cost).toFixed(2)}
                </p>
              </div>
              <Btn size="sm" variant="danger"
                   disabled={busy === s.id}
                   onClick={() => handleApply(s.id)}>
                {busy === s.id ? 'Applying…' : 'Apply Charges'}
              </Btn>
            </div>
            {i < pendingSessions.length - 1 && <Divider />}
          </div>
        ))}
      </div>
    </Card>
  );
}

interface MiscChargesSectionProps {
  miscCharges: MiscCharge[];
  onAdd: (amount: number, note: string) => Promise<void>;
  onReset: (id: string) => Promise<void>;
}
function MiscChargesSection({ miscCharges, onAdd, onReset }: MiscChargesSectionProps) {
  const [open, setOpen]   = useState(false);
  const [total, setTotal] = useState('');
  const [note, setNote]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  const handleSubmit = async () => {
    const val = parseFloat(total);
    if (!val || val <= 0) return setErr('Enter a valid amount');
    if (!note.trim()) return setErr('Description is required');
    setBusy(true); setErr('');
    try {
      await onAdd(val, note.trim());
      setTotal(''); setNote(''); setOpen(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle title="Misc Charges" />
        <Btn size="sm" variant="ghost" onClick={() => setOpen(v => !v)}>
          {open ? 'Cancel' : '+ Add'}
        </Btn>
      </div>
      {open && (
        <div className="flex flex-col gap-3 mb-4 p-3 bg-white/[0.05] border border-violet-400/10 rounded-lg">
          <Field label="Total Amount ($)" type="number"
                 value={total} onChange={setTotal} placeholder="0.00" />
          <Field label="Description" value={note} onChange={setNote}
                 placeholder="e.g. Shuttlecock purchase" />
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <Btn onClick={handleSubmit} disabled={busy}>
            {busy ? 'Applying…' : 'Apply to All Players'}
          </Btn>
        </div>
      )}
      <div className="flex flex-col">
        {miscCharges.map((mc, i) => (
          <div key={mc.id}>
            <div className="flex items-start justify-between py-3">
              <div>
                <p className="text-white text-sm">{mc.note || '—'}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {fmtDate(mc.created_at)} · ${Number(mc.per_player_amount).toFixed(2)}/player
                </p>
              </div>
              <div className="text-right">
                <p className="text-orange-400 text-sm font-semibold">
                  -${Number(mc.total_amount).toFixed(2)}
                </p>
                <button
                  onClick={() => {
                    if (!window.confirm(`Reset "${mc.note || 'this charge'}"? This will reverse all player deductions.`)) return;
                    onReset(mc.id);
                  }}
                  className="text-xs text-red-400 hover:text-red-300 mt-1 transition-colors"
                >
                  ↩ Reset
                </button>
              </div>
            </div>
            {i < miscCharges.length - 1 && <Divider />}
          </div>
        ))}
        {miscCharges.length === 0 && !open && (
          <p className="text-gray-500 text-sm text-center py-2">No misc charges yet</p>
        )}
      </div>
    </Card>
  );
}

interface AddCourtPaymentArgs {
  amount: number;
  hoursPurchased: number;
  note: string;
  paidAt: string;
}
interface AdjustmentEntry {
  id: string;
  player_id: string;
  player_name?: string;
  type: string;
  amount: number;
  created_at: string;
  note?: string;
  session_id?: string;
}

interface AdjustmentsSectionProps {
  adjustments: AdjustmentEntry[];
}
function AdjustmentsSection({ adjustments }: AdjustmentsSectionProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle title="Charge Adjustments" />
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-xs text-gray-400 hover:text-violet-400 transition-colors border border-gray-700 hover:border-violet-700 px-2 py-1 rounded-lg"
        >
          {collapsed ? '▼ Show' : '▲ Hide'}
        </button>
      </div>
      {collapsed && (
        <p className="text-gray-500 text-xs text-center py-1">
          {adjustments.length} adjustment{adjustments.length !== 1 ? 's' : ''} · tap Show to expand
        </p>
      )}
      {!collapsed && (
        <div className="flex flex-col">
          {adjustments.map((a, i) => (
            <div key={a.id}>
              <div className="flex items-center justify-between py-3">
                <div className="flex-1 min-w-0 pr-3">
                  <p className="text-white text-sm font-medium">{a.player_name ?? 'Unknown'}</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {fmtDate(a.created_at)}{a.note ? ` · ${a.note}` : ''}
                  </p>
                </div>
                <p className={`text-sm font-semibold ${Number(a.amount) >= 0 ? 'text-violet-400' : 'text-red-400'}`}>
                  {fmtSigned(Number(a.amount))}
                </p>
              </div>
              {i < adjustments.length - 1 && <Divider />}
            </div>
          ))}
          {adjustments.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">No adjustments yet</p>
          )}
        </div>
      )}
    </Card>
  );
}

interface CourtPaymentsSectionProps {
  courtPayments: CourtPaymentEntry[];
  onAdd: (data: AddCourtPaymentArgs) => Promise<void>;
}
function CourtPaymentsSection({ courtPayments, onAdd }: CourtPaymentsSectionProps) {
  const [open, setOpen]     = useState(false);
  const [amount, setAmount] = useState('');
  const [hours, setHours]   = useState('');
  const [note, setNote]     = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  const handleSubmit = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return setErr('Enter a valid amount');
    if (!paidAt) return setErr('Date is required');
    setBusy(true); setErr('');
    try {
      await onAdd({ amount: val, hoursPurchased: parseFloat(hours) || 0, note: note.trim(), paidAt });
      setAmount(''); setHours(''); setNote(''); setPaidAt(''); setOpen(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle title="Court Payments" />
        <Btn size="sm" variant="ghost" onClick={() => setOpen(v => !v)}>
          {open ? 'Cancel' : '+ Add'}
        </Btn>
      </div>
      {open && (
        <div className="flex flex-col gap-3 mb-4 p-3 bg-white/[0.05] border border-violet-400/10 rounded-lg">
          <Field label="Amount ($)" type="number"
                 value={amount} onChange={setAmount} placeholder="0.00" />
          <Field label="Hours Purchased (optional)" type="number"
                 value={hours} onChange={setHours} placeholder="e.g. 10 — blank if none" />
          <Field label="Date Paid" type="date" value={paidAt} onChange={setPaidAt} />
          <Field label="Note (optional)" value={note} onChange={setNote}
                 placeholder="e.g. 5 courts, Saturday morning" />
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <Btn onClick={handleSubmit} disabled={busy}>
            {busy ? 'Saving…' : 'Save Payment'}
          </Btn>
        </div>
      )}
      <div className="flex flex-col">
        {courtPayments.map((cp, i) => (
          <div key={cp.id}>
            <div className="flex items-start justify-between py-3">
              <div>
                <p className="text-white text-sm">{cp.note || '—'}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {fmtDate(cp.paid_at)}
                  {Number(cp.hours_purchased) > 0 ? ` · ${fmtHrs(cp.hours_purchased)} added` : ''}
                </p>
              </div>
              <p className="text-red-400 text-sm font-semibold">
                -${Number(cp.amount).toFixed(2)}
              </p>
            </div>
            {i < courtPayments.length - 1 && <Divider />}
          </div>
        ))}
        {courtPayments.length === 0 && !open && (
          <p className="text-gray-500 text-sm text-center py-2">No court payments logged yet</p>
        )}
      </div>
    </Card>
  );
}

interface PlayerFundViewProps {
  myBalance: number;
  fundBalance: number;
  myTransactions: Transaction[];
}
function PlayerFundView({ myBalance, fundBalance, myTransactions }: PlayerFundViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <SectionTitle title="My Balance" />
        <div className="text-center py-3">
          <p className={`text-5xl font-bold tracking-tight ${balColor(myBalance)}`}>
            {fmtAmt(myBalance)}
          </p>
          {myBalance < 0 && (
            <p className="text-red-400 text-xs mt-2">
              ⚠ Negative balance — please top up with your admin
            </p>
          )}
        </div>
      </Card>
      <Card>
        <SectionTitle title="Club Fund" />
        <div className="text-center py-2">
          <p className={`text-3xl font-bold ${balColor(fundBalance)}`}>
            {fmtAmt(fundBalance)}
          </p>
          <p className="text-gray-500 text-xs mt-1">Total available across all members</p>
        </div>
      </Card>
      <Card>
        <SectionTitle title="My Transactions" />
        <div className="flex flex-col">
          {(() => {
            const visible = myTransactions.filter(
              t => t.type === 'match_charge' || t.type === 'misc_charge' || t.type === 'top_up' || t.type === 'adjustment'
            );
            return visible.map((t, i) => (
              <div key={t.id}>
                <div className="flex items-center justify-between py-3">
                  <div className="flex-1 min-w-0 pr-3">
                    <p className={`text-sm font-medium ${TX_COLOR[t.type] ?? 'text-gray-400'}`}>
                      {LABELS[t.type] ?? t.type}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {fmtDate(t.created_at)}{t.note ? ` · ${t.note}` : ''}
                    </p>
                  </div>
                  <p className={`text-sm font-semibold ${Number(t.amount) >= 0 ? 'text-violet-400' : 'text-red-400'}`}>
                    {fmtSigned(Number(t.amount))}
                  </p>
                </div>
                {i < visible.length - 1 && <Divider />}
              </div>
            ));
          })()}
          {myTransactions.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">No transactions yet</p>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function FeesTab() {
  const { currentUser, isLoggedIn, setShowNamePicker } = useApp();
  const canManageFunds = currentUser?.role === 'admin' || currentUser?.role === 'treasurer';

  const {
    fundBalance, playerBalances,
    myBalance, myTransactions,
    courtPayments, miscCharges, pendingSessions, allAdjustments,
    courtHours, courtHoursAlertThreshold,
    loading, error, fundTrend,
    addTopUp, addMiscCharge, applyMatchCharges, addCourtPayment, deleteMiscCharge,
  } = useFunds(currentUser);

  const [topUpTarget, setTopUpTarget] = useState<PlayerBalance | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-violet-400 text-sm animate-pulse">Loading fund data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-400 text-sm">Error: {error}</p>
      </div>
    );
  }

  if (!canManageFunds && !isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 px-6">
        <p className="text-4xl">🔒</p>
        <p className="text-slate-300 text-sm font-semibold text-center">Login to view your balance and transactions</p>
        <button
          onClick={() => setShowNamePicker(true)}
          className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          Login
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {!canManageFunds && (
        <CourtHoursCard
          courtHours={courtHours}
          threshold={courtHoursAlertThreshold}
          showAlert={false}
        />
      )} 
       {canManageFunds ? (
        <>
          <FundSummaryCard fundBalance={fundBalance} fundTrend={fundTrend} />
          <CourtHoursCard
            courtHours={courtHours}
            threshold={courtHoursAlertThreshold}
            showAlert={true}
          />
          <PendingSessionsSection
            pendingSessions={pendingSessions}
            onApply={applyMatchCharges}
          />
          <PlayerBalancesList
            playerBalances={playerBalances}
            onTopUp={setTopUpTarget}
          />
          <MiscChargesSection
            miscCharges={miscCharges}
            onAdd={addMiscCharge}
            onReset={deleteMiscCharge}
          />
          <CourtPaymentsSection
            courtPayments={courtPayments}
            onAdd={addCourtPayment}
          />
          <AdjustmentsSection adjustments={allAdjustments} />
          {/* Admin personal transactions */}
          <Card>
            <SectionTitle title="My Transactions" />
            <div className="flex flex-col">
              {myTransactions.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No transactions yet</p>
              ) : (
                myTransactions.map((t, i) => (
                  <div key={t.id}>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex-1 min-w-0 pr-3">
                        <p className={`text-sm font-medium ${TX_COLOR[t.type] ?? 'text-gray-400'}`}>
                          {LABELS[t.type] ?? t.type}
                        </p>
                        <p className="text-gray-500 text-xs mt-0.5">
                          {fmtDate(t.created_at)}{t.note ? ` · ${t.note}` : ''}
                        </p>
                      </div>
                      <p className={`text-sm font-semibold ${Number(t.amount) >= 0 ? 'text-violet-400' : 'text-red-400'}`}>
                        {fmtSigned(Number(t.amount))}
                      </p>
                    </div>
                    {i < myTransactions.length - 1 && <Divider />}
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      ) : (
        <PlayerFundView
          myBalance={myBalance}
          fundBalance={fundBalance}
          myTransactions={myTransactions}
        />
      )}
      {topUpTarget && (
        <TopUpModal
          player={topUpTarget}
          onConfirm={addTopUp}
          onClose={() => setTopUpTarget(null)}
        />
      )}
    </div>
  );
}