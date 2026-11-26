import { useEffect, useState } from 'react';
import { Timer, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';

interface CourtPreview {
  enabled: boolean;
  threshold: number;
  repeatDays: number;
  remaining: number;
  isLow: boolean;
  decision: 'disabled' | 'ok' | 'send' | 'recently-sent';
  admins: string[];
}

// Admin card: alert admins (push + email) when the club's prepaid court hours
// drop below a threshold. Checked once a day by the daily-checks job.
export default function CourtHoursAlert() {
  const { settings, loadSettings, showToast, verifyAdminPin } = useApp();
  const enabled = settings.court_hours_alert === 'on';
  const [threshold, setThreshold] = useState(settings.court_hours_threshold ?? '10');
  const [repeatDays, setRepeatDays] = useState(settings.court_hours_repeat_days ?? '3');
  const [preview, setPreview] = useState<CourtPreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setThreshold(settings.court_hours_threshold ?? '10');
    setRepeatDays(settings.court_hours_repeat_days ?? '3');
  }, [settings]);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('low-balance-reminders', { body: { dryRun: true } });
    setLoading(false);
    if (error || !data?.courtHours) { showToast('Could not check court hours'); return; }
    setPreview(data.courtHours as CourtPreview);
  };

  useEffect(() => { void refresh(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.court_hours_alert, settings.court_hours_threshold]);

  const saveKey = async (key: string, value: string) => {
    const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) { showToast(`Could not save: ${error.message}`); return false; }
    return true;
  };

  const toggle = async () => {
    if (!verifyAdminPin()) return;
    const next = enabled ? 'off' : 'on';
    if (next === 'on' && !window.confirm(
      `Turn on the court-hours alert?\n\nOnce a day, if fewer than ${threshold} court hours are left, the admins get a push and email. It repeats every ${repeatDays} days until more hours are logged.`,
    )) return;
    if (await saveKey('court_hours_alert', next)) {
      await loadSettings();
      showToast(next === 'on' ? 'Court-hours alert on' : 'Court-hours alert off');
    }
  };

  const save = async () => {
    if (!verifyAdminPin()) return;
    const t = Number(threshold);
    const r = Math.round(Number(repeatDays));
    if (!Number.isFinite(t) || t < 0 || t > 500) { showToast('Hours must be 0–500'); return; }
    if (!Number.isFinite(r) || r < 1 || r > 30) { showToast('Repeat must be 1–30 days'); return; }
    if (await saveKey('court_hours_threshold', String(t)) && await saveKey('court_hours_repeat_days', String(r))) {
      await loadSettings();
      showToast('Court-hours alert saved');
    }
  };

  const low = preview?.isLow;

  return (
    <div className="bg-white/[0.05] border border-cyan-400/15 rounded-xl p-3 mb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Timer size={15} className="text-cyan-300" aria-hidden="true" />
          <div className="text-sm font-medium text-slate-200">Court-hours alert</div>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={enabled}
          className={`text-xs font-semibold rounded-full px-3 py-1 border transition-colors ${
            enabled ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/40' : 'bg-slate-800/60 text-slate-400 border-slate-700/40'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className={`mt-2 rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2 ${
        low ? 'bg-amber-900/25 border border-amber-600/40 text-amber-200' : 'bg-slate-900/50 border border-slate-700/40 text-slate-300'
      }`}>
        <span>
          {preview ? <>Hours left: <strong>{preview.remaining}</strong>{low && ' (below the alert level)'}</> : 'Checking hours…'}
        </span>
        <button onClick={refresh} disabled={loading} aria-label="Refresh court hours"
          className="text-slate-400 hover:text-slate-200 disabled:opacity-40">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="text-[11px] text-slate-500 mt-2 mb-2">
        Once a day, if hours left drop below this, {preview?.admins.length ? preview.admins.join(', ') : 'the admins'} get a push and email to book more.
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1 text-slate-400">
          Below
          <input type="number" min="0" step="1" value={threshold} onChange={e => setThreshold(e.target.value)}
            className="w-16 bg-slate-900/60 border border-slate-700/50 rounded-lg px-2 py-1 text-slate-100 focus:outline-none" />
          hours,
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          every
          <input type="number" min="1" max="30" step="1" value={repeatDays} onChange={e => setRepeatDays(e.target.value)}
            className="w-14 bg-slate-900/60 border border-slate-700/50 rounded-lg px-2 py-1 text-slate-100 focus:outline-none" />
          days
        </label>
        <button onClick={save}
          className="text-xs font-semibold text-cyan-200 bg-slate-800/60 border border-slate-700/40 rounded-lg px-3 py-1.5 hover:bg-slate-700/60 transition-colors">
          Save
        </button>
      </div>
    </div>
  );
}
