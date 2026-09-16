import { useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  buildLedgerCsv,
  buildBalancesCsv,
  filterByDateRange,
  ledgerFilename,
  type LedgerRow,
} from '../lib/ledgerCsv';

interface PlayerBalanceLike {
  name: string;
  balance: number;
}

interface LedgerExportProps {
  playerBalances: PlayerBalanceLike[];
}

function downloadCsv(filename: string, csv: string) {
  // Prepend a UTF-8 BOM so Excel opens accented names correctly.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function LedgerExport({ playerBalances }: LedgerExportProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const exportLedger = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // Join transactions → players for readable names. Supabase embeds the
      // related row under the foreign-key relationship.
      const { data, error } = await supabase
        .from('transactions')
        .select('created_at, type, amount, note, players(name)')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const rows: LedgerRow[] = (data ?? []).map((t: {
        created_at: string;
        type: string;
        amount: number;
        note?: string | null;
        players?: { name?: string } | { name?: string }[] | null;
      }) => {
        const rel = Array.isArray(t.players) ? t.players[0] : t.players;
        return {
          created_at: t.created_at,
          player_name: rel?.name ?? 'Unknown',
          type: t.type,
          amount: Number(t.amount),
          note: t.note ?? '',
        };
      });

      const filtered = filterByDateRange(rows, from, to);
      if (filtered.length === 0) {
        setMsg('No transactions in that date range.');
        return;
      }
      downloadCsv(ledgerFilename(from, to, 'ledger'), buildLedgerCsv(filtered));
      setMsg(`Exported ${filtered.length} transaction${filtered.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportBalances = () => {
    if (!playerBalances.length) { setMsg('No balances to export.'); return; }
    downloadCsv(ledgerFilename('', '', 'balances'), buildBalancesCsv(playerBalances));
    setMsg(`Exported ${playerBalances.length} player balances.`);
  };

  const inputCls =
    'flex-1 bg-white/[0.06] border border-[color:var(--card-border)] rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none';

  return (
    <div className="neon-card !rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Download size={15} style={{ color: 'var(--accent)' }} />
        <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
          Export Ledger
        </h3>
      </div>

      <p className="text-xs text-slate-400 mb-3">
        Download the full transaction history as a CSV for Splitwise reconciliation or backup. Leave dates blank for everything.
      </p>

      <div className="flex flex-col gap-2 mb-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 w-10">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 w-10">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={exportLedger}
          disabled={busy}
          className="flex-1 btn-gradient rounded-lg py-2 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          <Download size={14} />
          {busy ? 'Exporting…' : 'Ledger CSV'}
        </button>
        <button
          onClick={exportBalances}
          className="flex-1 rounded-lg py-2 text-sm font-semibold border transition-colors"
          style={{ borderColor: 'var(--card-border)', color: 'var(--text-primary)' }}
        >
          Balances CSV
        </button>
      </div>

      {msg && <p className="text-xs text-slate-400 mt-2">{msg}</p>}
    </div>
  );
}