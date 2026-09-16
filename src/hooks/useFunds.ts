import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const COURT_HOURS_ALERT_THRESHOLD = 20;

interface CurrentUser {
  id?: string;
  name?: string;
  role?: string;
}

interface PlayerBalance {
  id: string;
  name: string;
  balance: number;
}

interface Transaction {
  id: string;
  player_id: string;
  type: string;
  amount: number;
  created_at: string;
  note?: string;
  session_id?: string;
  misc_charge_id?: string;
}

interface CourtPayment {
  id: string;
  amount: number;
  hours_purchased: number;
  note?: string;
  paid_at: string;
}

interface MiscCharge {
  id: string;
  total_amount: number;
  per_player_amount: number;
  note?: string;
  created_at: string;
}

interface PendingSession {
  id: string;
  session_date: string;
  day: string;
  total_cost: number;
  per_person: number;
  players_count: number;
  players: (string | { name?: string; player_name?: string })[];
}

interface CourtHours {
  purchased: number;
  used: number;
  remaining: number;
  /** Set when Remaining came from a manual admin override. */
  override?: { value: number; date: string } | null;
}

interface AddCourtPaymentArgs {
  amount: number;
  hoursPurchased: number;
  note: string;
  paidAt: string;
}

export function useFunds(currentUser: CurrentUser | null) {
  const [fundBalance, setFundBalance]         = useState<number>(0);
  const [playerBalances, setPlayerBalances]   = useState<PlayerBalance[]>([]);
  const [myTransactions, setMyTransactions]   = useState<Transaction[]>([]);
  const [courtPayments, setCourtPayments]     = useState<CourtPayment[]>([]);
  const [miscCharges, setMiscCharges]         = useState<MiscCharge[]>([]);
  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([]);
  const [courtHours, setCourtHours]           = useState<CourtHours>({ purchased: 0, used: 0, remaining: 0, override: null });
  const [loading, setLoading]                 = useState<boolean>(true);
  const [error, setError]                     = useState<string | null>(null);
  const [fundTrend, setFundTrend]             = useState<{ date: string; balance: number }[]>([]);
  const [allAdjustments, setAllAdjustments]   = useState<(Transaction & { player_name?: string })[]>([]);

  const canManageFunds = currentUser?.role === 'admin' || currentUser?.role === 'treasurer';

  // ── Fetchers ───────────────────────────────────────────────

  const fetchFundBalance = useCallback(async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select('amount');
    if (error) throw error;
    setFundBalance(data.reduce((sum, t) => sum + Number(t.amount), 0));
  }, []);

  const fetchFundTrend = useCallback(async () => {
    const { data } = await supabase
      .from('transactions')
      .select('amount, created_at')
      .order('created_at', { ascending: true });
    if (!data) return;
    // Group by date, compute running balance
    const dayMap: Record<string, number> = {};
    let running = 0;
    data.forEach((t: { amount: number; created_at: string }) => {
      const day = t.created_at.slice(0, 10);
      running += Number(t.amount);
      dayMap[day] = running;
    });
    setFundTrend(Object.entries(dayMap).map(([date, balance]) => ({ date, balance })));
  }, []);

  const fetchPlayerBalances = useCallback(async () => {
    const { data: players, error: pErr } = await supabase
      .from('players')
      .select('id, name')
      .order('name');
    if (pErr) throw pErr;

    const { data: txns, error: tErr } = await supabase
      .from('transactions')
      .select('player_id, amount');
    if (tErr) throw tErr;

    const map: Record<string, number> = {};
    txns.forEach((t: { player_id: string; amount: number }) => {
      map[t.player_id] = (map[t.player_id] || 0) + Number(t.amount);
    });

    setPlayerBalances(players.map((p: { id: string; name: string }) => ({ ...p, balance: map[p.id] ?? 0 })));
  }, []);

  const fetchMyTransactions = useCallback(async () => {
    if (!currentUser?.id) return;
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('player_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    setMyTransactions(data);
  }, [currentUser?.id]);

  const fetchCourtPayments = useCallback(async () => {
    const { data, error } = await supabase
      .from('court_payments')
      .select('*')
      .order('paid_at', { ascending: false });
    if (error) throw error;
    setCourtPayments(data);
  }, []);

  const fetchMiscCharges = useCallback(async () => {
    const { data, error } = await supabase
      .from('misc_charges')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setMiscCharges(data);
  }, []);

  const fetchAllAdjustments = useCallback(async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, player_id, type, amount, created_at, note, session_id, misc_charge_id, players!inner(name)')
      .eq('type', 'adjustment')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const mapped = (data ?? []).map((t: Record<string, unknown> & { players?: { name: string } }) => ({
      id: t.id as string,
      player_id: t.player_id as string,
      type: t.type as string,
      amount: Number(t.amount),
      created_at: t.created_at as string,
      note: t.note as string | undefined,
      session_id: t.session_id as string | undefined,
      misc_charge_id: t.misc_charge_id as string | undefined,
      player_name: t.players?.name,
    }));
    setAllAdjustments(mapped);
  }, []);

  const fetchPendingSessions = useCallback(async () => {
    const { data, error } = await supabase
      .from('completed_sessions')
      .select('id, session_date, day, total_cost, per_person, players_count, players')
      .eq('auto_deducted', false)
      .order('session_date', { ascending: false });
    if (error) throw error;
    setPendingSessions(data);
  }, []);

  const fetchCourtHours = useCallback(async () => {
    const { data: cpData, error: cpErr } = await supabase
      .from('court_payments')
      .select('hours_purchased');
    if (cpErr) throw cpErr;
    const purchased = cpData.reduce((sum: number, r: { hours_purchased: number }) => sum + Number(r.hours_purchased || 0), 0);

    const { data: csData, error: csErr } = await supabase
      .from('completed_sessions')
      .select('courts_count, created_at, session_hours');
    if (csErr) throw csErr;
    const used = csData.reduce((sum: number, r: { courts_count: number; session_hours?: number }) => sum + (Number(r.courts_count || 0) * Number(r.session_hours ?? 2)), 0);

    const systemCalculated = purchased - used;

    // Use array select to avoid .single() throwing on missing row
    const { data: settingsRows } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'hours_override');

    let remaining = systemCalculated;
    let displayPurchased = purchased;
    let displayUsed = used;
    let activeOverride: { value: number; date: string } | null = null;
    const settingsData = settingsRows?.[0];

    if (settingsData?.value) {
      try {
        const override = JSON.parse(settingsData.value);
        if (override && typeof override.value === 'number' && override.date) {
          const overrideTime = new Date(override.date).getTime();
          const deductionsSinceOverride = csData
            .filter((s: { created_at: string }) => new Date(s.created_at).getTime() > overrideTime)
            .reduce((sum: number, s: { courts_count: number; session_hours?: number }) => sum + (Number(s.courts_count || 0) * Number(s.session_hours ?? 2)), 0);
          remaining = override.value - deductionsSinceOverride;
          activeOverride = { value: override.value, date: override.date };
          displayPurchased = override.value;
          displayUsed = deductionsSinceOverride;
        }
      } catch { /* ignore malformed override */ }
    }

    setCourtHours({ purchased: displayPurchased, used: displayUsed, remaining, override: activeOverride });
  }, []);

  // ── Load all ───────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchFundBalance(),
        fetchMyTransactions(),
        fetchCourtHours(),
        fetchFundTrend(),
      ]);
      if (canManageFunds) {
        await Promise.all([
          fetchPlayerBalances(),
          fetchCourtPayments(),
          fetchMiscCharges(),
          fetchPendingSessions(),
          fetchAllAdjustments(),
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [
    canManageFunds,
    fetchFundBalance,
    fetchMyTransactions,
    fetchPlayerBalances,
    fetchCourtPayments,
    fetchMiscCharges,
    fetchPendingSessions,
    fetchAllAdjustments,
    fetchCourtHours,
    fetchFundTrend,
  ]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Realtime ───────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('funds_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'court_payments' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'misc_charges' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completed_sessions' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => loadAll())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadAll]);

  // ── Mutations ──────────────────────────────────────────────

  const addTopUp = async (playerId: string, amount: number, note = ''): Promise<void> => {
    const { error } = await supabase.from('transactions').insert({
      player_id: playerId,
      type: 'top_up',
      amount: Math.abs(amount),
      note,
    });
    if (error) throw error;
    await loadAll();
  };

  const addMiscCharge = async (totalAmount: number, note = ''): Promise<void> => {
    const { data: players, error: pErr } = await supabase
      .from('players')
      .select('id');
    if (pErr) throw pErr;

    const count = players.length;
    if (count === 0) throw new Error('No registered players found');

    const perPlayer = totalAmount / count;

    const { data: mc, error: mcErr } = await supabase
      .from('misc_charges')
      .insert({
        total_amount: totalAmount,
        per_player_amount: perPlayer,
        note,
        created_by: currentUser?.id,
      })
      .select()
      .single();
    if (mcErr) throw mcErr;

    const txns = players.map((p: { id: string }) => ({
      player_id: p.id,
      type: 'misc_charge',
      amount: -perPlayer,
      misc_charge_id: mc.id,
      note,
    }));

    const { error: tErr } = await supabase.from('transactions').insert(txns);
    if (tErr) throw tErr;
    await loadAll();
  };

  const deleteMiscCharge = async (miscChargeId: string): Promise<void> => {
    const { error: tErr } = await supabase
      .from('transactions')
      .delete()
      .eq('misc_charge_id', miscChargeId);
    if (tErr) throw tErr;

    const { error: mErr } = await supabase
      .from('misc_charges')
      .delete()
      .eq('id', miscChargeId);
    if (mErr) throw mErr;

    await loadAll();
  };

  const applyMatchCharges = async (sessionId: string): Promise<void> => {
    const { data: session, error: sErr } = await supabase
      .from('completed_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    if (sErr) throw sErr;
    if (session.auto_deducted) throw new Error('Charges already applied for this session');

    const rawPlayers: (string | { name?: string; player_name?: string })[] = session.players ?? [];
    const playerNames = rawPlayers
      .map(p => (typeof p === 'string' ? p : (p.name ?? p.player_name ?? '')))
      .filter(Boolean);

    if (playerNames.length === 0) throw new Error('No players found in session record');

    const { data: matched, error: pErr } = await supabase
      .from('players')
      .select('id, name')
      .in('name', playerNames);
    if (pErr) throw pErr;
    if (!matched.length) throw new Error('No matching players found in players table');

    const perPlayer = matched.length > 0
      ? Number(session.total_cost) / matched.length
      : Number(session.per_person);

    const txns = matched.map((p: { id: string; name: string }) => ({
      player_id: p.id,
      type: 'match_charge',
      amount: -perPlayer,
      session_id: String(sessionId),
      note: `Match — ${session.session_date} · ${matched.length} players · $${perPlayer.toFixed(2)} each`,
    }));

    const { error: tErr } = await supabase.from('transactions').insert(txns);
    if (tErr) throw tErr;

    const { error: uErr } = await supabase
      .from('completed_sessions')
      .update({ auto_deducted: true })
      .eq('id', sessionId);
    if (uErr) throw uErr;

    await loadAll();
  };

  const addCourtPayment = async ({ amount, hoursPurchased, note, paidAt }: AddCourtPaymentArgs): Promise<void> => {
    const { error } = await supabase.from('court_payments').insert({
      amount,
      hours_purchased: hoursPurchased || 0,
      note,
      paid_at: paidAt,
    });
    if (error) throw error;

    // If an hours override is active, increase it by the new hours purchased
    // so the override stays in sync with actual court payments.
    if (hoursPurchased > 0) {
      const { data: rows } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'hours_override');
      const raw = rows?.[0]?.value;
      if (raw) {
        try {
          const override = JSON.parse(raw);
          if (override && typeof override.value === 'number') {
            await supabase
              .from('settings')
              .update({ value: JSON.stringify({ ...override, value: override.value + hoursPurchased }) })
              .eq('key', 'hours_override');
          }
        } catch { /* ignore malformed override */ }
      }
    }

    await loadAll();
  };

  const myBalance = myTransactions.reduce((sum, t) => sum + Number(t.amount), 0);

  return {
    fundBalance,
    playerBalances,
    myTransactions,
    myBalance,
    courtPayments,
    miscCharges,
    pendingSessions,
    allAdjustments,
    courtHours,
    courtHoursAlertThreshold: COURT_HOURS_ALERT_THRESHOLD,
    loading,
    error,
    refresh: loadAll,
    addTopUp,
    addMiscCharge,
    fundTrend,
    applyMatchCharges,
    addCourtPayment,
    deleteMiscCharge,
  };
}