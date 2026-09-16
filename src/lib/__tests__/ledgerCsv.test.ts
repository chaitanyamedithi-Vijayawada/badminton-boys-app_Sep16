import { describe, it, expect } from 'vitest';
import {
  csvCell,
  filterByDateRange,
  buildLedgerCsv,
  buildBalancesCsv,
  ledgerFilename,
  type LedgerRow,
} from '../ledgerCsv';

describe('csvCell escaping', () => {
  it('leaves plain values untouched', () => {
    expect(csvCell('Arun')).toBe('Arun');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(null)).toBe('');
  });
  it('quotes and escapes commas, quotes, newlines', () => {
    expect(csvCell('Match, Wednesday')).toBe('"Match, Wednesday"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('filterByDateRange (inclusive)', () => {
  const rows = [
    { created_at: '2026-01-01T10:00:00Z' },
    { created_at: '2026-02-15T10:00:00Z' },
    { created_at: '2026-03-31T23:00:00Z' },
  ];
  it('bounds both ends inclusively', () => {
    expect(filterByDateRange(rows, '2026-02-01', '2026-03-31')).toHaveLength(2);
  });
  it('open-ended when a side is empty', () => {
    expect(filterByDateRange(rows, '', '2026-01-31')).toHaveLength(1);
    expect(filterByDateRange(rows, '2026-02-01', '')).toHaveLength(2);
    expect(filterByDateRange(rows, '', '')).toHaveLength(3);
  });
});

describe('buildLedgerCsv', () => {
  const rows: LedgerRow[] = [
    { created_at: '2026-02-10T00:00:00Z', player_name: 'Bob', type: 'top_up', amount: 50, note: null },
    { created_at: '2026-01-05T00:00:00Z', player_name: 'Ann', type: 'match_charge', amount: -22, note: 'Tue' },
    { created_at: '2026-03-01T00:00:00Z', player_name: 'Ann', type: 'match_charge', amount: -8, note: 'Sat' },
  ];

  it('sorts oldest→newest and maintains a running total', () => {
    const csv = buildLedgerCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Date,Player,Type,Amount,Running Total,Note');
    // Row order: Ann -22 (Jan) → Bob +50 (Feb) → Ann -8 (Mar)
    expect(lines[1]).toContain('2026-01-05,Ann,Match Charge,-22.00,-22.00');
    expect(lines[2]).toContain('2026-02-10,Bob,Top-Up,50.00,28.00');
    expect(lines[3]).toContain('2026-03-01,Ann,Match Charge,-8.00,20.00');
  });

  it('humanizes known types and passes unknown ones through', () => {
    const csv = buildLedgerCsv([
      { created_at: '2026-01-01T00:00:00Z', player_name: 'X', type: 'mystery', amount: 1 },
    ]);
    expect(csv).toContain(',mystery,');
  });

  it('escapes notes containing commas', () => {
    const csv = buildLedgerCsv([
      { created_at: '2026-01-01T00:00:00Z', player_name: 'X', type: 'top_up', amount: 5, note: 'cash, e-transfer' },
    ]);
    expect(csv).toContain('"cash, e-transfer"');
  });
});

describe('buildBalancesCsv', () => {
  it('sorts by name and appends a fund total', () => {
    const csv = buildBalancesCsv([
      { name: 'Zoe', balance: -10 },
      { name: 'Amy', balance: 30 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Player,Balance');
    expect(lines[1]).toBe('Amy,30.00');
    expect(lines[2]).toBe('Zoe,-10.00');
    expect(lines[3]).toBe('TOTAL (fund),20.00');
  });
});

describe('ledgerFilename', () => {
  it('uses the range, falling back to start/today', () => {
    expect(ledgerFilename('2026-01-01', '2026-03-31')).toBe('badminton-ledger_2026-01-01_to_2026-03-31.csv');
    expect(ledgerFilename('', '')).toBe('badminton-ledger_start_to_today.csv');
    expect(ledgerFilename('', '', 'balances')).toBe('badminton-balances_start_to_today.csv');
  });
});
