import { useState } from 'react';
import { Clock, CreditCard as Edit3, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import type { HoursOverride } from '../../types';

interface CourtHoursSummaryProps {
  totalPurchased: number;
  totalUsed: number;
  remainingHours: number;
  hoursOverride: HoursOverride | null;
  systemCalculated: number;
}

export default function CourtHoursSummary({
  totalPurchased,
  totalUsed,
  remainingHours,
  hoursOverride,
  systemCalculated,
}: CourtHoursSummaryProps) {
  const { loadSettings, showToast, verifyAdminPin } = useApp();
  const [overriding, setOverriding] = useState(false);
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const startOverride = () => {
    if (!verifyAdminPin()) return;
    setOverrideValue(remainingHours.toFixed(1));
    setOverrideReason('');
    setOverriding(true);
  };

  const saveOverride = async () => {
    const newVal = parseFloat(overrideValue);
    if (isNaN(newVal) || newVal < 0) {
      showToast('Invalid hours');
      return;
    }
    if (!overrideReason.trim()) {
      showToast('Please enter a reason');
      return;
    }

    const overrideData: HoursOverride = {
      value: newVal,
      system_value: systemCalculated,
      date: new Date().toISOString(),
      reason: overrideReason.trim(),
    };

    await supabase.from('settings').upsert(
      { key: 'hours_override', value: JSON.stringify(overrideData) },
      { onConflict: 'key' }
    );

    await loadSettings();
    setOverriding(false);
    showToast('Hours override saved');
  };

  const clearOverride = async () => {
    if (!verifyAdminPin()) return;
    await supabase.from('settings').upsert(
      { key: 'hours_override', value: '' },
      { onConflict: 'key' }
    );
    await loadSettings();
    showToast('Override cleared');
  };

  return (
    <div className="neon-card card-sky mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={16} className="text-cyan-400" />
        <span className="text-sm font-semibold text-slate-200">Court Hours</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-slate-800/50 rounded-lg px-3 py-2.5">
          <div className="text-xs text-slate-400 mb-1">Purchased</div>
          <div className="text-base font-bold text-cyan-400">{totalPurchased.toFixed(1)}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg px-3 py-2.5">
          <div className="text-xs text-slate-400 mb-1">Used</div>
          <div className="text-base font-bold text-red-400">{totalUsed.toFixed(1)}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg px-3 py-2.5">
          <div className="text-xs text-slate-400 mb-1">Remaining</div>
          <div className={`text-base font-bold ${remainingHours < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {remainingHours.toFixed(1)}
          </div>
        </div>
      </div>

      {hoursOverride && (
        <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-amber-300">
              Overridden on {new Date(hoursOverride.date).toLocaleDateString()}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              System value: {hoursOverride.system_value.toFixed(1)} | Override: {hoursOverride.value.toFixed(1)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Reason: {hoursOverride.reason}</div>
          </div>
          <button
            onClick={clearOverride}
            className="text-xs text-amber-400 hover:text-amber-300 underline flex-shrink-0"
          >
            Clear
          </button>
        </div>
      )}

      {overriding ? (
        <div className="bg-slate-800/50 rounded-lg px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-16">Hours:</label>
            <input
              type="number"
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              className="flex-1 bg-slate-900/60 border border-cyan-700/40 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              step="0.5"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-16">Reason:</label>
            <input
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why override?"
              className="flex-1 bg-slate-900/60 border border-slate-700/40 rounded px-2 py-1 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setOverriding(false)}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-300 border border-slate-600/40"
            >Cancel</button>
            <button
              onClick={saveOverride}
              className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600 text-white font-medium"
            >Save Override</button>
          </div>
        </div>
      ) : (
        <button
          onClick={startOverride}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors"
        >
          <Edit3 size={12} />
          Override hours balance
        </button>
      )}
    </div>
  );
}