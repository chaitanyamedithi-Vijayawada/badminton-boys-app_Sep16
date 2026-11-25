import { useCallback, useEffect, useRef, useState } from 'react';
import { Trophy, Plus, Trash2, X, Camera } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { notifyTournamentWinners } from '../lib/notifications';

export interface WinnerRow {
  id: string;
  tournament_name: string;
  played_month: string | null;       // 'YYYY-MM'
  champions: string[];
  runners_up: string[];
  champions_photo: string | null;
  runners_up_photo: string | null;
  group_photo: string | null;
  final_score: string | null;
  created_at: string;
}

const GOLD = '#facc15';
const SILVER = '#cbd5e1';

function fmtMonth(m: string | null) {
  if (!m) return '';
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Scale a photo down (keeping its shape) so uploads stay small, as JPEG. */
function shrinkPhoto(file: File, maxDim = 1200): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Photo failed'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('Photo could not be read'));
    img.src = url;
  });
}

async function uploadWinnerPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Photo must be an image');
  if (file.size > 15 * 1024 * 1024) throw new Error('Photo must be under 15 MB');
  const blob = await shrinkPhoto(file);
  const path = `winners/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

// Tournament winners board. Admins add each tournament by hand: month played,
// winners and runners-up names, and a photo for each. Newest first.
export default function TournamentWinners() {
  const { players, currentUser, showToast } = useApp();
  const isAdmin = currentUser?.role === 'admin';
  const [rows, setRows] = useState<WinnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('tournament_winners')
      .select('*')
      .order('played_month', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    setRows((data as WinnerRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel('tournament_winners')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_winners' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const remove = async (row: WinnerRow) => {
    if (!window.confirm(`Remove "${row.tournament_name}" from the winners list?`)) return;
    const { error } = await supabase.from('tournament_winners').delete().eq('id', row.id);
    if (error) { showToast("Couldn't remove it. Try again."); return; }
    showToast('Removed');
    load();
  };

  return (
    <div>
      {isAdmin && !adding && (
        <button onClick={() => setAdding(true)}
          className="w-full mb-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          style={{ background: GOLD, color: '#1a1300' }}>
          <Plus size={16} /> Add tournament winners
        </button>
      )}

      {adding && (
        <AddWinnerForm
          clubPlayers={players.filter(p => !p.archived).map(p => p.name).sort((a, b) => a.localeCompare(b))}
          onCancel={() => setAdding(false)}
          onSaved={() => { setAdding(false); showToast('Winners added 🏆'); load(); }}
          onError={msg => showToast(msg)}
        />
      )}

      {loading ? (
        <div className="text-center text-slate-500 text-sm py-10">Loading winners…</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center py-12 px-6">
          <Trophy size={44} style={{ color: GOLD, opacity: 0.5 }} />
          <p className="text-slate-300 text-sm font-semibold">No winners yet</p>
          <p className="text-slate-500 text-xs">
            {isAdmin ? 'Add the winners after each tournament and they\'ll show up here.' : 'Winners will show up here after each tournament.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={r.id} className="rounded-2xl overflow-hidden border"
              style={{
                background: 'linear-gradient(160deg, rgba(250,204,21,0.14), rgba(16,15,10,0.95) 55%)',
                borderColor: i === 0 ? 'rgba(250,204,21,0.65)' : 'rgba(250,204,21,0.28)',
                boxShadow: i === 0 ? '0 0 18px rgba(250,204,21,0.25)' : undefined,
              }}>
              <div className="flex items-start justify-between gap-2 p-4 pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Trophy size={24} style={{ color: GOLD }} className="flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-lg font-bold text-white leading-tight truncate">{r.tournament_name}</div>
                    <div className="text-sm font-semibold" style={{ color: GOLD }}>
                      {fmtMonth(r.played_month)}
                      {r.final_score && <span className="text-slate-400 font-medium"> · Final {r.final_score}</span>}
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={() => remove(r)} aria-label="Remove" className="p-1.5 text-slate-500 hover:text-red-400">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {r.group_photo && (
                <div className="px-4 pb-4">
                  <div className="text-xs font-extrabold uppercase tracking-wider mb-2 text-slate-300">👥 All players</div>
                  <button onClick={() => setViewPhoto(r.group_photo!)} className="block w-full">
                    <img src={r.group_photo} alt="All players" loading="lazy"
                      className="w-full rounded-xl object-cover border border-white/10" style={{ maxHeight: 280 }} />
                  </button>
                </div>
              )}

              <Side label="🥇 Winners" color={GOLD} names={r.champions} photo={r.champions_photo} big onPhoto={setViewPhoto} />
              {(r.runners_up.length > 0 || r.runners_up_photo) && (
                <Side label="🥈 Runners-up" color={SILVER} names={r.runners_up} photo={r.runners_up_photo} onPhoto={setViewPhoto} />
              )}
            </div>
          ))}
        </div>
      )}

      {viewPhoto && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)' }}
          onClick={() => setViewPhoto(null)}>
          <img src={viewPhoto} alt="" className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  );
}

function Side({ label, color, names, photo, big, onPhoto }: {
  label: string; color: string; names: string[]; photo: string | null; big?: boolean; onPhoto: (u: string) => void;
}) {
  return (
    <div className="px-4 pb-4">
      <div className="text-xs font-extrabold uppercase tracking-wider mb-2" style={{ color }}>{label}</div>
      {photo && (
        <button onClick={() => onPhoto(photo)} className="block w-full mb-2">
          <img src={photo} alt={label} loading="lazy"
            className="w-full rounded-xl object-cover border"
            style={{ maxHeight: big ? 260 : 180, borderColor: color + '55' }} />
        </button>
      )}
      <div className={big ? 'text-lg font-bold text-white' : 'text-base font-semibold text-slate-200'}>
        {names.join(' & ')}
      </div>
    </div>
  );
}

function PhotoPicker({ label, color, file, onChange }: { label: string; color: string; file: File | null; onChange: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="mb-4">
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { onChange(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      {preview ? (
        <div className="relative">
          <img src={preview} alt="" className="w-full max-h-48 object-cover rounded-xl" />
          <button onClick={() => onChange(null)} aria-label="Remove photo"
            className="absolute top-2 right-2 p-1 rounded-full bg-black/70 text-white"><X size={14} /></button>
        </div>
      ) : (
        <button onClick={() => ref.current?.click()}
          className="w-full py-3 rounded-xl border border-dashed text-sm flex items-center justify-center gap-2"
          style={{ borderColor: color + '88', color }}>
          <Camera size={16} /> {label}
        </button>
      )}
    </div>
  );
}

function NamesInput({ label, color, names, setNames, clubPlayers }: {
  label: string; color: string; names: string[]; setNames: (v: string[]) => void; clubPlayers: string[];
}) {
  const [text, setText] = useState('');
  const add = (n: string) => {
    const v = n.trim();
    if (v && !names.includes(v)) setNames([...names, v]);
    setText('');
  };
  const suggestions = text.trim()
    ? clubPlayers.filter(p => p.toLowerCase().includes(text.trim().toLowerCase()) && !names.includes(p)).slice(0, 5)
    : [];
  return (
    <div className="mb-2">
      <div className="text-xs font-bold mb-1.5" style={{ color }}>{label}</div>
      {names.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {names.map(n => (
            <span key={n} className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1"
              style={{ background: color, color: '#111' }}>
              {n}
              <button onClick={() => setNames(names.filter(x => x !== n))} aria-label={`Remove ${n}`}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(text); } }}
          placeholder="Type a name"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm" />
        <button onClick={() => add(text)} disabled={!text.trim()}
          className="px-3 rounded-lg text-sm font-bold disabled:opacity-40" style={{ background: color, color: '#111' }}>Add</button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {suggestions.map(s => (
            <button key={s} onClick={() => add(s)}
              className="px-2.5 py-1 rounded-full text-xs border border-slate-600 text-slate-300">+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddWinnerForm({ clubPlayers, onCancel, onSaved, onError }: {
  clubPlayers: string[]; onCancel: () => void; onSaved: () => void; onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('en-CA').slice(0, 7));
  const [score, setScore] = useState('');
  const [champions, setChampions] = useState<string[]>([]);
  const [runnersUp, setRunnersUp] = useState<string[]>([]);
  const [champPhoto, setChampPhoto] = useState<File | null>(null);
  const [runnerPhoto, setRunnerPhoto] = useState<File | null>(null);
  const [groupPhoto, setGroupPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const canSave = !!name.trim() && !!month && champions.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const [cp, rp, gp] = await Promise.all([
        champPhoto ? uploadWinnerPhoto(champPhoto) : Promise.resolve(null),
        runnerPhoto ? uploadWinnerPhoto(runnerPhoto) : Promise.resolve(null),
        groupPhoto ? uploadWinnerPhoto(groupPhoto) : Promise.resolve(null),
      ]);
      const { error } = await supabase.from('tournament_winners').insert({
        tournament_name: name.trim(),
        played_month: month,
        champions,
        runners_up: runnersUp,
        champions_photo: cp,
        runners_up_photo: rp,
        group_photo: gp,
        final_score: score.trim() || null,
      });
      if (error) throw error;
      // Let the whole club know (fire-and-forget; a push failure never blocks saving).
      notifyTournamentWinners(name.trim(), champions, !!(cp || rp || gp));
      onSaved();
    } catch (e) {
      onError(e instanceof Error && e.message.startsWith('Photo') ? e.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl p-4 mb-4 border" style={{ background: 'rgba(15,18,20,0.97)', borderColor: 'rgba(250,204,21,0.4)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-base font-bold text-white">Add tournament winners</div>
        <button onClick={onCancel} aria-label="Close" className="text-slate-400"><X size={18} /></button>
      </div>

      <label className="block text-xs text-slate-400 mb-1">Tournament name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Winter Cup"
        className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm" />

      <div className="flex gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <label className="block text-xs text-slate-400 mb-1">Month played</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm" />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-xs text-slate-400 mb-1">Final score (optional)</label>
          <input value={score} onChange={e => setScore(e.target.value)} placeholder="21–18"
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm" />
        </div>
      </div>

      <div className="text-xs font-bold mb-1.5 text-slate-300">👥 Photo of all players</div>
      <PhotoPicker label="Add group photo" color="#94a3b8" file={groupPhoto} onChange={setGroupPhoto} />

      <NamesInput label="🥇 Winners" color={GOLD} names={champions} setNames={setChampions} clubPlayers={clubPlayers} />
      <PhotoPicker label="Add winners photo" color={GOLD} file={champPhoto} onChange={setChampPhoto} />

      <NamesInput label="🥈 Runners-up" color={SILVER} names={runnersUp} setNames={setRunnersUp} clubPlayers={clubPlayers} />
      <PhotoPicker label="Add runners-up photo" color={SILVER} file={runnerPhoto} onChange={setRunnerPhoto} />

      <button onClick={save} disabled={!canSave}
        className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-40 mt-1"
        style={{ background: GOLD, color: '#1a1300' }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
