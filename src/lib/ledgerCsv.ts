// ── Ledger CSV export ─────────────────────────────────────────────────────────
// Pure helpers to turn the transaction ledger into CSV text. Kept dependency-
// free and side-effect-free so they're unit-testable; the actual file download
// lives in the component.

export interface LedgerRow {
  created_at: string;
  player_name: string;
  type: string;
  amount: number;
  note?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  top_up: 'Top-Up',
  match_charge: 'Match Charge',
  misc_charge: 'Misc Charge',
  adjustment: 'Charge Adjustment',
};

// RFC-4180 escaping: wrap in quotes if the value contains comma, quote, or
// newline, and double any embedded quotes.
export function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

// Inclusive date-range filter on the ISO created_at timestamp. `from`/`to` are
// YYYY-MM-DD strings (local calendar days); either may be empty to leave that
// side unbounded.
export function filterByDateRange<T extends { created_at: string }>(
  rows: T[],
  from: string,
  to: string,
): T[] {
  const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
  return rows.filter(r => {
    const t = new Date(r.created_at).getTime();
    return t >= fromMs && t <= toMs;
  });
}

// Full ledger CSV: header + one row per transaction, sorted oldest→newest, with
// a running total column so the sheet reconciles against the fund balance.
export function buildLedgerCsv(rows: LedgerRow[]): string {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const header = csvRow(['Date', 'Player', 'Type', 'Amount', 'Running Total', 'Note']);
  let running = 0;

  const lines = sorted.map(r => {
    running += Number(r.amount) || 0;
    const dateStr = new Date(r.created_at).toISOString().split('T')[0];
    return csvRow([
      dateStr,
      r.player_name,
      TYPE_LABELS[r.type] ?? r.type,
      (Number(r.amount) || 0).toFixed(2),
      running.toFixed(2),
      r.note ?? '',
    ]);
  });

  return [header, ...lines].join('\r\n');
}

// Per-player balance summary CSV (a second export option / second sheet).
export interface BalanceRow {
  name: string;
  balance: number;
}

export function buildBalancesCsv(rows: BalanceRow[]): string {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const header = csvRow(['Player', 'Balance']);
  const lines = sorted.map(r => csvRow([r.name, (Number(r.balance) || 0).toFixed(2)]));
  const total = sorted.reduce((s, r) => s + (Number(r.balance) || 0), 0);
  const totalLine = csvRow(['TOTAL (fund)', total.toFixed(2)]);
  return [header, ...lines, totalLine].join('\r\n');
}

// Build a filename like "badminton-ledger_2026-01-01_to_2026-03-31.csv".
export function ledgerFilename(from: string, to: string, kind = 'ledger'): string {
  const a = from || 'start';
  const b = to || 'today';
  return `badminton-${kind}_${a}_to_${b}.csv`;
}
