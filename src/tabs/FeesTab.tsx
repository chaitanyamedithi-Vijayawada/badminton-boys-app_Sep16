import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
// FeesTab.tsx and HomeTab.tsx — change back to:
import { useFunds } from '../hooks/useFunds';

// ── Types ────────────────────────────────────────────────────────────────────

interface PlayerBalance {
  id: string;
  name: string;
  balance: number;
  receivables?: number;
  payables?: number;
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
  const { remaining } = courtHours;
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
      <div className="bg-white/[0.05] border border-violet-400/10 rounded-lg p-3 text-center">
        <p className="text-gray-500 text-xs mb-1">Balance</p>
        <p className={`text-2xl font-bold ${balColor(remaining)}`}>{fmtHrs(remaining)}</p>
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
      {miscCharges.length === 0 && !open ? (
        <p className="text-gray-500 text-sm text-center py-2">No misc charges yet</p>
      ) : miscCharges.length > 0 && (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -4px' }}>
          <table style={ADMIN_TABLE}>
            <colgroup>
              <col style={{ width: 46 }} /><col /><col style={{ width: 52 }} /><col style={{ width: 66 }} />
            </colgroup>
            <thead>
              <tr>
                {['Date', 'Description', '/Player', 'Amount'].map((h, idx) => (
                  <th key={h} style={{ ...ADMIN_TH, textAlign: idx >= 2 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {miscCharges.map(mc => (
                <tr key={mc.id}>
                  <td style={ADMIN_TD_DATE}>{fmtDateShort(mc.created_at)}</td>
                  <td style={ADMIN_TD}>
                    <span style={{ ...ADMIN_DESC, color: SUBJECT_COLOR.misc }}>
                      <span style={{ ...ADMIN_DOT, background: SUBJECT_COLOR.misc }} />
                      {mc.note || '—'}
                    </span>
                  </td>
                  <td style={{ ...ADMIN_TD_NUM, color: '#cbd5e1' }}>${Number(mc.per_player_amount).toFixed(2)}</td>
                  <td style={ADMIN_TD_NUM}>
                    <span style={{ color: '#fb923c', fontWeight: 600 }}>-${Number(mc.total_amount).toFixed(2)}</span>
                    <button
                      onClick={() => {
                        if (!window.confirm(`Reset "${mc.note || 'this charge'}"? This will reverse all player deductions.`)) return;
                        onReset(mc.id);
                      }}
                      style={{ display: 'block', marginLeft: 'auto', marginTop: 3, fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      ↩ Reset
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
        adjustments.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No adjustments yet</p>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -4px' }}>
            <table style={ADMIN_TABLE}>
              <colgroup><col style={{ width: 46 }} /><col /><col style={{ width: 66 }} /></colgroup>
              <thead>
                <tr>
                  {['Date', 'Player / note', 'Amount'].map((h, idx) => (
                    <th key={h} style={{ ...ADMIN_TH, textAlign: idx >= 2 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adjustments.map(a => (
                  <tr key={a.id}>
                    <td style={ADMIN_TD_DATE}>{fmtDateShort(a.created_at)}</td>
                    <td style={ADMIN_TD}>
                      <span style={{ ...ADMIN_DESC, color: SUBJECT_COLOR.adj }}>
                        <span style={{ ...ADMIN_DOT, background: SUBJECT_COLOR.adj }} />
                        {a.player_name ?? 'Unknown'}
                      </span>
                      {a.note && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, marginLeft: 13, wordBreak: 'break-word' }}>{a.note}</div>}
                    </td>
                    <td style={{ ...ADMIN_TD_NUM, color: Number(a.amount) >= 0 ? '#a78bfa' : '#f87171', fontWeight: 600 }}>
                      {fmtSigned(Number(a.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
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
      {courtPayments.length === 0 && !open ? (
        <p className="text-gray-500 text-sm text-center py-2">No court payments logged yet</p>
      ) : courtPayments.length > 0 && (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -4px' }}>
          <table style={ADMIN_TABLE}>
            <colgroup>
              <col style={{ width: 46 }} /><col /><col style={{ width: 48 }} /><col style={{ width: 66 }} />
            </colgroup>
            <thead>
              <tr>
                {['Date', 'Description', 'Hours', 'Amount'].map((h, idx) => (
                  <th key={h} style={{ ...ADMIN_TH, textAlign: idx >= 2 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courtPayments.map(cp => {
                const isCorrection = /correction|historical|backfill/i.test(cp.note ?? '');
                const color = isCorrection ? SUBJECT_COLOR.adj : SUBJECT_COLOR.sat;
                const hrs = Number(cp.hours_purchased) > 0 ? `+${Number(cp.hours_purchased).toFixed(1)}` : '—';
                return (
                  <tr key={cp.id}>
                    <td style={ADMIN_TD_DATE}>{fmtDateShort(cp.paid_at)}</td>
                    <td style={ADMIN_TD}>
                      <span style={{ ...ADMIN_DESC, color }}>
                        <span style={{ ...ADMIN_DOT, background: color }} />
                        {cp.note || '—'}
                      </span>
                    </td>
                    <td style={{ ...ADMIN_TD_NUM, color: '#cbd5e1' }}>{hrs}</td>
                    <td style={{ ...ADMIN_TD_NUM, color: '#f87171', fontWeight: 600 }}>-${Number(cp.amount).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Transaction ledger (standard debit / credit / running-balance view) ───────
// Constant colour per subject so the ledger is scannable at a glance.
const SUBJECT_COLOR = {
  open:  '#a3e635',  // opening balance — lime
  sat:   '#7dd3fc',  // Saturday — sky
  mid:   '#a78bfa',  // Tuesday / Wednesday — violet
  dep:   '#34d399',  // deposit / top-up — green
  extra: '#fbbf24',  // extra session — amber
  guest: '#f0abfc',  // guest charge — pink
  misc:  '#5eead4',  // birdie / misc — teal
  adj:   '#94a3b8',  // adjustment — slate
} as const;

// Shared ledger-style table styles, reused by the admin Misc Charges / Court
// Payments sections so they match the My Transactions ledger.
const ADMIN_TABLE: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 300 };
const ADMIN_CELL_BORDER = '1px solid rgba(255,255,255,0.05)';
const ADMIN_TH: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#9aa3b2', padding: '7px 5px', borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap' };
const ADMIN_TD: React.CSSProperties = { padding: '7px 5px', borderBottom: ADMIN_CELL_BORDER, verticalAlign: 'top' };
const ADMIN_TD_DATE: React.CSSProperties = { ...ADMIN_TD, fontSize: 10.5, color: '#8b93a7', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const ADMIN_TD_NUM: React.CSSProperties = { ...ADMIN_TD, textAlign: 'right', fontSize: 11, fontVariantNumeric: 'tabular-nums' };
const ADMIN_DESC: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5, lineHeight: 1.25, wordBreak: 'break-word' };
const ADMIN_DOT: React.CSSProperties = { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', position: 'relative', top: 1 };

function classifySubject(t: Transaction): { label: string; color: string } {
  const note = t.note ?? '';
  if (t.type === 'top_up') {
    if (/opening balance/i.test(note)) return { label: 'Opening balance', color: SUBJECT_COLOR.open };
    return { label: 'Deposit', color: SUBJECT_COLOR.dep };
  }
  if (/guest charge/i.test(note)) {
    const m = note.match(/Guest Charge\s*—\s*(.+?)\s+hosted by/i);
    return { label: m ? `Guest: ${m[1].trim()}` : 'Guest', color: SUBJECT_COLOR.guest };
  }
  if (/extra session/i.test(note)) {
    const m = note.match(/Extra Session\s*—\s*([^·]+)/i);
    return { label: m ? `Extra: ${m[1].trim()}` : 'Extra session', color: SUBJECT_COLOR.extra };
  }
  if (/adjustment/i.test(note)) return { label: 'Adjustment', color: SUBJECT_COLOR.adj };
  if (t.type === 'misc_charge') return { label: note || 'Misc charge', color: SUBJECT_COLOR.misc };
  if (/saturday/i.test(note)) return { label: 'Saturday badminton', color: SUBJECT_COLOR.sat };
  if (/wednesday/i.test(note)) return { label: 'Wednesday badminton', color: SUBJECT_COLOR.mid };
  if (/tuesday/i.test(note)) return { label: 'Tuesday badminton', color: SUBJECT_COLOR.mid };
  return { label: LABELS[t.type] ?? t.type, color: SUBJECT_COLOR.misc };
}

// Compact "Oct 3" date (Pacific), handling both full timestamps and date-only notes.
const fmtDateShort = (d: string): string => {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(m ? {} : { timeZone: 'America/Vancouver' }),
  });
};

// Pacific "YYYY-MM" bucket for a timestamp, so months group by the club's TZ.
const monthKeyOf = (iso: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(iso));
  const y = parts.find(p => p.type === 'year')?.value ?? '';
  const m = parts.find(p => p.type === 'month')?.value ?? '';
  return `${y}-${m}`;
};
const monthLabelOf = (mk: string): string => {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

function LedgerTable({ transactions }: { transactions: Transaction[] }) {
  const [month, setMonth] = useState<string>('all');

  const visible = transactions
    .filter(t => ['match_charge', 'misc_charge', 'top_up', 'adjustment'].includes(t.type))
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (visible.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">No transactions yet</p>;
  }

  // Running balance is ALWAYS computed oldest → newest so each row's Balance is
  // the true balance as of that date, even when filtered to one month.
  let running = 0;
  const allRows = visible.map((t, i) => {
    const amt = Number(t.amount) || 0;
    running += amt;
    const isOpening = i === 0 && t.type === 'top_up' && /opening balance/i.test(t.note ?? '');
    return {
      id: t.id,
      mk: monthKeyOf(t.created_at),
      date: isOpening ? 'Opening' : fmtDateShort(t.created_at),
      subj: classifySubject(t),
      amt, running, isOpening,
    };
  });

  const months = Array.from(new Set(allRows.map(r => r.mk))).sort().reverse();
  const scoped = month === 'all' ? allRows : allRows.filter(r => r.mk === month);

  // When one month is shown, a "brought forward" row carries in the balance from
  // prior months so the filtered view still reconciles.
  let broughtForward: number | null = null;
  if (month !== 'all' && scoped.length > 0) {
    const firstIdx = allRows.findIndex(r => r.id === scoped[0].id);
    if (firstIdx > 0) broughtForward = allRows[firstIdx - 1].running;
  }

  // Newest first for display; the opening / brought-forward context sits at the bottom.
  const display = [...scoped].reverse();

  const num2 = (n: number) => Math.abs(n).toFixed(2);
  const cellBorder = '1px solid rgba(255,255,255,0.05)';

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          aria-label="Filter by month"
          style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(124,92,255,0.25)',
            color: '#cbd5e1', fontSize: 11, fontWeight: 600, borderRadius: 8, padding: '4px 8px',
          }}
        >
          <option value="all">All months</option>
          {months.map(mk => <option key={mk} value={mk}>{monthLabelOf(mk)}</option>)}
        </select>
      </div>
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 300 }}>
          <colgroup>
            <col style={{ width: 44 }} /><col /><col style={{ width: 48 }} />
            <col style={{ width: 48 }} /><col style={{ width: 58 }} />
          </colgroup>
          <thead>
            <tr>
              {['Date', 'Description', 'Debit', 'Credit', 'Balance'].map((h, idx) => (
                <th key={h} style={{
                  textAlign: idx >= 2 ? 'right' : 'left', fontSize: 9.5, fontWeight: 700,
                  letterSpacing: '0.04em', textTransform: 'uppercase', color: '#9aa3b2',
                  padding: '7px 5px', borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map(r => (
              <tr key={r.id} style={r.isOpening ? { background: 'rgba(163,230,53,0.07)' } : undefined}>
                <td style={{ padding: '7px 5px', fontSize: 10.5, color: '#8b93a7', borderBottom: cellBorder, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.date}</td>
                <td style={{ padding: '7px 5px', borderBottom: cellBorder }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5, lineHeight: 1.25, color: r.subj.color, fontWeight: r.isOpening ? 700 : 500, wordBreak: 'break-word' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.subj.color, flex: '0 0 auto', position: 'relative', top: 1 }} />
                    {r.subj.label}
                  </span>
                </td>
                <td style={{ padding: '7px 5px', textAlign: 'right', fontSize: 11, color: '#f87171', borderBottom: cellBorder, fontVariantNumeric: 'tabular-nums' }}>
                  {!r.isOpening && r.amt < 0 ? num2(r.amt) : ''}
                </td>
                <td style={{ padding: '7px 5px', textAlign: 'right', fontSize: 11, color: '#34d399', borderBottom: cellBorder, fontVariantNumeric: 'tabular-nums' }}>
                  {!r.isOpening && r.amt > 0 ? num2(r.amt) : ''}
                </td>
                <td style={{ padding: '7px 5px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: r.running < 0 ? '#f87171' : '#f1f5f9', borderBottom: cellBorder, fontVariantNumeric: 'tabular-nums' }}>
                  {r.running < 0 ? '-' : ''}{num2(r.running)}
                </td>
              </tr>
            ))}
            {broughtForward !== null && (
              <tr>
                <td style={{ padding: '7px 5px', fontSize: 10.5, color: '#64748b', borderBottom: cellBorder, whiteSpace: 'nowrap' }}>—</td>
                <td style={{ padding: '7px 5px', borderBottom: cellBorder }}>
                  <span style={{ fontSize: 11, fontStyle: 'italic', color: '#8b93a7' }}>Balance brought forward</span>
                </td>
                <td style={{ borderBottom: cellBorder }} />
                <td style={{ borderBottom: cellBorder }} />
                <td style={{ padding: '7px 5px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: broughtForward < 0 ? '#f87171' : '#94a3b8', borderBottom: cellBorder, fontVariantNumeric: 'tabular-nums' }}>
                  {broughtForward < 0 ? '-' : ''}{num2(broughtForward)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
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
        <LedgerTable transactions={myTransactions} />
      </Card>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

// Player who fronts the court fees. In the Fund Manager their row shows
// "to receive" = value of the remaining (not-yet-played) court hours, instead
// of their raw transaction balance which is misleadingly negative. The club
// reimburses them gradually as hours are used, so the remaining-hours value is
// exactly what is still owed. See project technical-learnings.
const FUND_HOLDER_NAME = 'Arun';

interface FundManagerCardProps {
  playerBalances: PlayerBalance[];
  remainingHours: number;
  courtRate: number;
}
function FundManagerCard({ playerBalances, remainingHours, courtRate }: FundManagerCardProps) {
  const [collapsed, setCollapsed] = useState(true);

  const courtFloat  = remainingHours * courtRate;            // value of unplayed court hours
  const holderRaw   = playerBalances.find(p => p.name === FUND_HOLDER_NAME);

  // Arun is listed like any other player, but his balance is his court float
  // (value of unplayed hours), not his raw transaction ledger. Everyone —
  // Arun included — is summed into the Treasurer total.
  type FundRow = { id: string; name: string; balance: number; receivables?: number; payables?: number; cashier?: boolean; raw?: number };
  const rows: FundRow[] = playerBalances
    .filter(p => p.name !== FUND_HOLDER_NAME)
    .map(p => ({ id: p.id, name: p.name, balance: p.balance, receivables: p.receivables, payables: p.payables }));
  if (holderRaw) {
    rows.push({ id: holderRaw.id, name: holderRaw.name, balance: courtFloat, cashier: true, raw: holderRaw.balance });
  }
  rows.sort((a, b) => b.balance - a.balance);
  const treasurer = rows.reduce((s, p) => s + p.balance, 0);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle title="Fund Manager" />
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-xs text-gray-400 hover:text-violet-400 transition-colors border border-gray-700 hover:border-violet-700 px-2 py-1 rounded-lg"
        >
          {collapsed ? '▼ Show' : '▲ Hide'}
        </button>
      </div>

      {/* Summary — always visible */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/[0.05] border border-violet-400/10 rounded-lg p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Total Fund</p>
          <p className="text-xl font-bold text-violet-300">{fmtAmt(treasurer)}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">(all players)</p>
        </div>
        <div className="bg-white/[0.05] border border-violet-400/10 rounded-lg p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Court $ left</p>
          <p className="text-xl font-bold text-violet-300">{fmtAmt(courtFloat)}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{remainingHours.toFixed(1)} hrs × ${courtRate.toFixed(2)}</p>
        </div>
      </div>

      {collapsed && (
        <p className="text-gray-500 text-xs text-center py-1 mt-1">
          {rows.length} players · tap Show for the full table
        </p>
      )}

      {!collapsed && (
        <div className="mt-2">
          <div className="flex items-center text-[10px] uppercase tracking-wider text-gray-500 px-1 pb-1 border-b border-gray-800">
            <span className="flex-1">Player</span>
            <span className="w-16 text-right">Paid in</span>
            <span className="w-16 text-right">Used</span>
            <span className="w-20 text-right">Balance</span>
          </div>
          {rows.map((p, i) => (
            <div
              key={p.id}
              className="flex items-center py-2 px-1"
              style={i < rows.length - 1 ? { borderBottom: '1px solid rgba(31,41,55,0.6)' } : undefined}
            >
              <span className="flex-1 min-w-0 pr-2">
                <span className="text-white text-sm block truncate">
                  {p.name}{p.cashier ? <span className="text-[10px] text-gray-500"> · cashier</span> : null}
                </span>
                {p.cashier && p.raw !== undefined && (
                  <span className="text-[10px] text-gray-500">raw ledger: {fmtAmt(p.raw)}</span>
                )}
              </span>
              <span className="w-16 text-right text-xs text-gray-300">{p.receivables != null ? `$${p.receivables.toFixed(2)}` : '—'}</span>
              <span className="w-16 text-right text-xs text-gray-400">{p.payables != null ? `$${p.payables.toFixed(2)}` : '—'}</span>
              <span className={`w-20 text-right text-sm font-semibold ${balColor(p.balance)}`}>{fmtAmt(p.balance)}</span>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">No players found</p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function FeesTab() {
  const { currentUser, isLoggedIn, setShowNamePicker } = useApp();
  const canManageFunds = currentUser?.role === 'admin' || currentUser?.role === 'treasurer';

  const {
    fundBalance, playerBalances,
    myBalance, myTransactions,
    courtPayments, miscCharges, pendingSessions, allAdjustments,
    courtHours, courtRate, courtHoursAlertThreshold,
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
          <FundManagerCard
            playerBalances={playerBalances}
            remainingHours={courtHours.remaining}
            courtRate={courtRate}
          />
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
            <LedgerTable transactions={myTransactions} />
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
