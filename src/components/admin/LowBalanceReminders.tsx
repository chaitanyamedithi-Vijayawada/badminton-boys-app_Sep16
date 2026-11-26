import { useEffect, useState } from 'react';
import { BellRing, Eye } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';

interface Preview {
  enabled: boolean;
  threshold: number;
  repeatDays: number;
  wouldRemind: { name: string; balance: number; hasEmail: boolean }[];
  remindedRecently: { name: string; balance: number }[];
}

const money = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);

// Admin card: turn automatic low-balance reminders on/off, set the threshold
// and how often to repeat, and preview who would be reminded (no sending).
export default function LowBalanceReminders() {
  const { settings, loadSettings, showToast, verifyAdminPin } = useApp();
  const enabled = settings.low_balance_reminders === 'on';
  const [threshold, setThreshold] = useState(settings.low_balance_threshold ?? '10');
  const [repeatDays, setRepeatDays] = useState(settings.low_balance_repeat_days ?? '7');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const recipient = settings.payment_recipient_name || 'Arun';

  useEffect(() => {
    setThreshold(settings.low_balance_threshold ?? '10');
    setRepeatDays(settings.low_balance_repeat_days ?? '7');
  }, [settings]);

  const saveKey = async (key: string, value: string) => {
    const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) { showToast(`Could not save: ${error.message}`); return false; }
    return true;
  };

  const toggle = async () => {
    if (!verifyAdminPin()) return;
    const next = enabled ? 'off' : 'on';
    if (next === 'on' && !window.confirm(
      `Turn on low-balance reminders?\n\nEvery day at about 10–11 AM, players under $${Number(threshold).toFixed(2)} get a push and email asking them to e-Transfer ${recipient}. Each player gets at most one every ${repeatDays} days.`,
    )) return;
    if (await saveKey('low_balance_reminders', next)) {
      await loadSettings();
      setPreview(null);
      showToast(next === 'on' ? 'Low-balance reminders on' : 'Low-balance reminders off');
    }
  };

  const save = async () => {
    if (!verifyAdminPin()) return;
    const t = Number(threshold);
    const r = Math.round(Number(repeatDays));
    if (!Number.isFinite(t) || t < 0 || t > 1000) { showToast('Threshold must be $0–$1000'); return; }
    if (!Number.isFinite(r) || r < 1 || r > 60) { showToast('Repeat must be 1–60 days'); return; }
    if (await saveKey('low_balance_threshold', String(t)) && await saveKey('low_balance_repeat_days', String(r))) {
      await loadSettings();
      setPreview(null);
      showToast('Reminder settings saved');
    }
  };

  const runPreview = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('low-balance-reminders', { body: { dryRun: true } });
    setLoading(false);
    if (error || !data || data.error) { showToast('Could not load the preview'); return; }
    setPreview(data as Preview);
  };

  return (
    <div className="bg-white/[0.05] border border-amber-400/15 rounded-xl p-3 mt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BellRing size={15} className="text-amber-300" aria-hidden="true" />
          <div className="text-sm font-medium text-slate-200">Low-balance reminders</div>
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
      <div className="text-[11px] text-slate-500 mt-1 mb-2">
        Once a day, players below the amount get a push and email asking them to e-Transfer {recipient}. The fund manager and treasurer accounts are skipped.
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1 text-slate-400">
          Below $
          <input type="number" min="0" step="1" value={threshold} onChange={e => setThreshold(e.target.value)}
            className="w-16 bg-slate-900/60 border border-slate-700/50 rounded-lg px-2 py-1 text-slate-100 focus:outline-none" />
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          every
          <input type="number" min="1" max="60" step="1" value={repeatDays} onChange={e => setRepeatDays(e.target.value)}
            className="w-14 bg-slate-900/60 border border-slate-700/50 rounded-lg px-2 py-1 text-slate-100 focus:outline-none" />
          days
        </label>
        <button onClick={save}
          className="text-xs font-semibold text-amber-200 bg-slate-800/60 border border-slate-700/40 rounded-lg px-3 py-1.5 hover:bg-slate-700/60 transition-colors">
          Save
        </button>
        <button onClick={runPreview} disabled={loading}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-200 bg-slate-800/60 border border-slate-700/40 rounded-lg px-3 py-1.5 hover:bg-slate-700/60 disabled:opacity-50 transition-colors">
          <Eye size={12} aria-hidden="true" />{loading ? 'Checking…' : 'Who would get it?'}
        </button>
      </div>

      {preview && (
        <div className="mt-3 text-xs bg-slate-900/50 border border-slate-700/40 rounded-lg p-2.5">
          {preview.wouldRemind.length === 0 ? (
            <div className="text-slate-400">Nobody is below ${preview.threshold.toFixed(2)} right now.</div>
          ) : (
            <>
              <div className="text-slate-300 mb-1">
                {preview.enabled ? 'Next reminder goes to:' : 'If turned on, the next reminder would go to:'}
              </div>
              <ul className="space-y-0.5">
                {preview.wouldRemind.map(p => (
                  <li key={p.name} className="flex justify-between gap-2">
                    <span className="text-slate-200">{p.name}{!p.hasEmail && <span className="text-slate-500"> (push only)</span>}</span>
                    <span className="text-amber-300 font-semibold">{money(p.balance)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.remindedRecently.length > 0 && (
            <div className="text-slate-500 mt-1.5">
              Already reminded in the last {preview.repeatDays} days: {preview.remindedRecently.map(p => p.name).join(', ')}
            </div>
          )}
          <div className="text-slate-500 mt-2 border-t border-slate-700/40 pt-2">
            Message: “Hi Name, your CourtCrew balance is $X. Please e-Transfer {recipient} to top up, then tap ‘I’ve sent it’ in the app.”
          </div>
        </div>
      )}
    </div>
  );
}
