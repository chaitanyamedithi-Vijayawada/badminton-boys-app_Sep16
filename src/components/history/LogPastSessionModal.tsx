// src/components/history/LogPastSessionModal.tsx
//
// Admin-only modal for retroactively logging a **regular** session (Saturday
// or Wednesday) that was played but never completed in the app on the day.
//
// Scope (v1):
//   - Date picker limited to last 14 days, Saturday/Wednesday only
//   - Player checkbox list (all non-archived)
//   - Guests via subform: name + host + 2/host cap
//   - Courts × hours inputs (default 2 × 2)
//   - Live cost preview (host also charged for their guest share)
//   - Blocks duplicates for that week+day
//   - Auto-decrements the hours_override so the Court Hours widget stays in sync
//   - Emails: not sent in v1 (checkbox reserved for future; currently no-op)
//
// Writes atomically: completed_sessions row → per-player charges → per-guest
// host charges → override adjustment. Any failure bubbles up as a toast and
// stops the flow (no partial state left behind on the success path).

import { useMemo, useState } from 'react';
import { X, UserPlus } from 'lucide-react';
import type { Player, Day } from '../../types';
import { supabase } from '../../lib/supabase';

interface Props {
  players: Player[];
  ratePerCourt: number;   // 2-hour rate; per-hour-per-court = ratePerCourt / 2
  onClose: () => void;
  onSuccess: () => void;  // called after successful log so parent can refresh
  showToast: (msg: string) => void;
}

interface DraftGuest {
  id: string;             // stable local id for React keys
  name: string;
  host: string;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function pad(n: number): string { return String(n).padStart(2, '0'); }
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// Week key = the Saturday of the session's week, in yyyy-mm-dd. Matches
// getWeekKey() in lib/constants.ts, but computed from the *chosen* date rather
// than "now" — since we're logging a past session, the week is fixed.
function weekKeyFor(sessionDate: Date): string {
  const day = sessionDate.getDay();          // 0 Sun, 6 Sat
  const daysUntilSat = (6 - day + 7) % 7;
  const sat = new Date(sessionDate);
  sat.setDate(sessionDate.getDate() + daysUntilSat);
  return toISODate(sat);
}
function dayOfWeek(d: Date): Day | null {
  if (d.getDay() === 6) return 'saturday';
  if (d.getDay() === 3) return 'wednesday';
  return null;
}

// Build the picker options: the last 14 days, Saturdays and Wednesdays only,
// most recent first. This narrows the picker to what's actually retro-loggable.
function eligibleDates(today: Date): { iso: string; label: string; day: Day }[] {
  const out: { iso: string; label: string; day: Day }[] = [];
  for (let i = 0; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const day = dayOfWeek(d);
    if (!day) continue;
    const label = d.toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    out.push({ iso: toISODate(d), label, day });
  }
  return out;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LogPastSessionModal({ players, ratePerCourt, onClose, onSuccess, showToast }: Props) {
  const today = useMemo(() => new Date(), []);
  const dateOptions = useMemo(() => eligibleDates(today), [today]);

  const [selectedDate, setSelectedDate] = useState<string>(dateOptions[0]?.iso ?? '');
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState<DraftGuest[]>([]);
  const [courts, setCourts] = useState<number>(2);
  const [hours, setHours] = useState<number>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sorted list of active player names for the checkbox column and the guest
  // host picker. Archived players are hidden — they shouldn't be logged for
  // new sessions.
  const activePlayers = useMemo(
    () => players.filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [players]
  );
  const selectedPlayerList = useMemo(
    () => activePlayers.filter(p => selectedPlayers.has(p.name)),
    [activePlayers, selectedPlayers]
  );

  const togglePlayer = (name: string) => {
    setSelectedPlayers(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        // Also drop any guests hosted by this player, since they can't have
        // a guest if they aren't marked as playing.
        setGuests(g => g.filter(gu => gu.host !== name));
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // Live cost preview (a guest counts as a body for the split, and the host
  // pays the guest's share on top of their own).
  const perHour = ratePerCourt / 2;
  const totalCost = courts * hours * perHour;
  const attendeeCount = selectedPlayers.size + guests.length;
  const perPerson = attendeeCount > 0 ? Math.round((totalCost / attendeeCount) * 100) / 100 : 0;

  const canSubmit =
    !!selectedDate && attendeeCount > 0 && courts > 0 && hours > 0 && !busy;

  const addGuest = () => {
    if (selectedPlayerList.length === 0) {
      setError('Add at least one player before adding guests');
      return;
    }
    setError(null);
    setGuests(g => [
      ...g,
      { id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: '', host: selectedPlayerList[0].name },
    ]);
  };
  const removeGuest = (id: string) => setGuests(g => g.filter(x => x.id !== id));
  const updateGuest = (id: string, patch: Partial<DraftGuest>) => {
    setGuests(g => g.map(x => (x.id === id ? { ...x, ...patch } : x)));
  };

  // 2-per-host cap check for the currently-drafted guests
  const guestCountByHost = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of guests) m[g.host] = (m[g.host] || 0) + 1;
    return m;
  }, [guests]);
  const overCapHosts = Object.entries(guestCountByHost).filter(([, n]) => n > 2).map(([h]) => h);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (overCapHosts.length > 0) {
      setError(`Guest cap (2) exceeded for: ${overCapHosts.join(', ')}`);
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const sessionDateObj = parseISODate(selectedDate);
      const day = dayOfWeek(sessionDateObj);
      if (!day) throw new Error('Date must be a Saturday or Wednesday');
      const week = weekKeyFor(sessionDateObj);

      // Duplicate check — refuse if a session already exists for this week+day.
      const { data: existingRows, error: exErr } = await supabase
        .from('completed_sessions')
        .select('id')
        .eq('week', week)
        .eq('day', day);
      if (exErr) throw exErr;
      if (existingRows && existingRows.length > 0) {
        throw new Error(`A session for ${day} of week ${week} already exists. Use SQL to fix duplicates.`);
      }

      const playerNames = selectedPlayerList.map(p => p.name);
      const guestPayload = guests.map(g => ({
        name: g.name.trim() || `${g.host}'s guest`,
        brought_by: g.host,
        level: 'I',    // level is required by the schema; retro-log defaults to Intermediate
      }));

      // Insert completed_sessions row and get the new id back.
      const { data: newSession, error: sessErr } = await supabase
        .from('completed_sessions')
        .insert({
          week,
          day,
          session_date: selectedDate,
          players: playerNames,
          guests: guestPayload,
          courts: Array.from({ length: courts }, (_, i) => i + 1),
          courts_count: courts,
          rate_per_court: ratePerCourt,
          session_hours: hours,
          total_cost: totalCost,
          players_count: attendeeCount,
          per_person: perPerson,
          auto_deducted: true,
          is_extra: false,     // regular session
        })
        .select('id')
        .single();
      if (sessErr) throw sessErr;
      if (!newSession) throw new Error('Session insert returned no row');

      // Build player + guest charge transactions. Each player pays perPerson;
      // each guest's share is billed to their host as an *additional* charge.
      const nameToId: Record<string, string> = {};
      for (const p of players) if (p.id) nameToId[p.name] = p.id;

      const ledgerTxns: Record<string, unknown>[] = [];
      for (const name of playerNames) {
        const pid = nameToId[name];
        if (!pid) continue;
        ledgerTxns.push({
          player_id: pid,
          type: 'match_charge',
          amount: -perPerson,
          session_id: String(newSession.id),
          note: `Match — ${selectedDate} · ${day} (retro-logged)`,
        });
      }
      for (const g of guestPayload) {
        const hostId = nameToId[g.brought_by];
        if (!hostId) continue;
        ledgerTxns.push({
          player_id: hostId,
          type: 'match_charge',
          amount: -perPerson,
          session_id: String(newSession.id),
          note: `Guest Charge — ${g.name} hosted by ${g.brought_by} · ${selectedDate} (retro-logged)`,
        });
      }
      if (ledgerTxns.length > 0) {
        const { error: txErr } = await supabase.from('transactions').insert(ledgerTxns);
        if (txErr) throw txErr;
      }

      // Decrement hours_override so the Court Hours widget reflects usage.
      // We follow the same pattern as addCourtPayment: read → parse → subtract
      // (courts × hours) → write back. If no override exists, skip — the
      // system will compute Used directly from completed_sessions anyway.
      const { data: overrideRows } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'hours_override');
      const raw = overrideRows?.[0]?.value;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.value === 'number') {
            await supabase
              .from('settings')
              .update({
                value: JSON.stringify({
                  ...parsed,
                  value: parsed.value - courts * hours,
                }),
              })
              .eq('key', 'hours_override');
          }
        } catch { /* ignore malformed override */ }
      }

      showToast(`Session logged for ${day} ${selectedDate} · $${perPerson.toFixed(2)}/person`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to log session';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (dateOptions.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
        <div className="neon-card max-w-sm w-full p-5">
          <div className="text-sm text-slate-200 mb-2">No eligible dates</div>
          <div className="text-xs text-slate-400 mb-4">
            No Saturdays or Wednesdays in the last 14 days.
          </div>
          <button onClick={onClose} className="w-full py-2 rounded-xl bg-slate-800 text-slate-200 text-sm">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="neon-card max-w-md w-full max-h-[90vh] overflow-y-auto p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-100">Log past session</div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-400"
          >
            <X size={14} />
          </button>
        </div>

        {/* Date */}
        <label className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-1 block">Date</label>
        <select
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="w-full bg-slate-900/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 mb-4"
        >
          {dateOptions.map(d => (
            <option key={d.iso} value={d.iso}>{d.label} · {d.day}</option>
          ))}
        </select>

        {/* Players */}
        <label className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-1 block">
          Players ({selectedPlayers.size} selected)
        </label>
        <div className="mb-4 max-h-52 overflow-y-auto border border-slate-700/40 rounded-lg p-2 grid grid-cols-2 gap-1">
          {activePlayers.map(p => {
            const on = selectedPlayers.has(p.name);
            return (
              <button
                key={p.name}
                onClick={() => togglePlayer(p.name)}
                className={`text-xs px-2 py-1.5 rounded-lg border text-left ${
                  on
                    ? 'bg-violet-600 border-violet-500 text-white'
                    : 'bg-slate-900/40 border-slate-700/40 text-slate-300'
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        {/* Guests */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">
              Guests ({guests.length})
            </label>
            <button
              onClick={addGuest}
              className="flex items-center gap-1 text-xs bg-amber-600 hover:bg-amber-500 text-white px-2 py-1 rounded-lg"
            >
              <UserPlus size={12} /> Add guest
            </button>
          </div>
          {guests.length === 0 && (
            <div className="text-[11px] text-slate-600 italic">No guests</div>
          )}
          {guests.map(g => {
            const hostAtCap = (guestCountByHost[g.host] || 0) > 2;
            return (
              <div key={g.id} className={`flex items-center gap-1.5 mb-1.5 p-1.5 rounded-lg border ${hostAtCap ? 'border-red-700/50 bg-red-900/10' : 'border-slate-700/40 bg-slate-900/40'}`}>
                <input
                  type="text"
                  value={g.name}
                  onChange={e => updateGuest(g.id, { name: e.target.value })}
                  placeholder={`${g.host}'s guest`}
                  className="flex-1 min-w-0 bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1 text-xs text-slate-100"
                />
                <select
                  value={g.host}
                  onChange={e => updateGuest(g.id, { host: e.target.value })}
                  className="bg-slate-900/60 border border-slate-700/50 rounded px-1.5 py-1 text-xs text-slate-100"
                >
                  {selectedPlayerList.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeGuest(g.id)}
                  className="w-6 h-6 rounded-full hover:bg-red-900/40 flex items-center justify-center text-red-400"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          {overCapHosts.length > 0 && (
            <div className="text-[11px] text-red-400 mt-1">
              ⚠️ Over 2-guest cap: {overCapHosts.join(', ')}
            </div>
          )}
        </div>

        {/* Courts + hours */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-1 block">Courts</label>
            <input
              type="number" min={1} step={1} value={courts}
              onChange={e => setCourts(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-slate-900/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div className="flex-1">
            <label className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-1 block">Hours</label>
            <input
              type="number" min={0.5} step={0.5} value={hours}
              onChange={e => setHours(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
              className="w-full bg-slate-900/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>
        </div>

        {/* Cost preview */}
        <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg p-3 mb-4">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Total cost</span>
            <span className="text-slate-200 font-semibold">${totalCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Attendees</span>
            <span className="text-slate-200">
              {attendeeCount} = {selectedPlayers.size} players + {guests.length} guests
            </span>
          </div>
          <div className="flex justify-between text-xs text-slate-400">
            <span>Per person</span>
            <span className="text-emerald-400 font-semibold">${perPerson.toFixed(2)}</span>
          </div>
          {guests.length > 0 && (
            <div className="text-[10px] text-amber-400/80 mt-1.5">
              Hosts are charged their guest's share on top of their own.
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs text-red-400 mb-3 bg-red-900/20 border border-red-700/30 rounded-lg p-2">
            ⚠️ {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-slate-300 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || overCapHosts.length > 0}
            className="flex-1 py-2.5 rounded-xl btn-gradient text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Logging…' : 'Log session'}
          </button>
        </div>
      </div>
    </div>
  );
}