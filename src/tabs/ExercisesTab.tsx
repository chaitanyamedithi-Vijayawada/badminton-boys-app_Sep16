import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Snowflake, Play, Pause, SkipForward, SkipBack, X, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import AvatarLightbox from '../components/AvatarLightbox';

// Warm-up (pre-game) and cool-down (post-game) routines for badminton.
// Exercises live in Supabase (public.warmup_exercises, read-only via RLS) and
// their looping GIFs in the public "warmups" storage bucket. GIFs (~300 KB) are
// used everywhere instead of the PNGs (~1.4 MB) to keep mobile data low.

interface Exercise {
  id: string;
  sort_order: number;
  name: string;
  body_part: string;
  duration_sec: number;
  gif_path: string | null;
}

type Mode = 'warmup' | 'cooldown';

// Static stretches belong after play; everything else is a dynamic warm-up.
const COOL_DOWN_NAMES = new Set([
  'Shoulder Stretch', 'Wrist Stretch', 'Hip Flexor Stretch', 'Hamstring Stretch',
  'Quad Stretch', 'Overhead Stretch', 'Prayer Stretch', 'Butterfly Stretch', 'Figure-4 Stretch',
]);

const BODY_PARTS = ['shoulder', 'hand', 'hip', 'leg', 'feet', 'cardio', 'core'] as const;
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const WARM = '#f59e0b'; // amber
const COOL = '#38bdf8'; // sky
const CARD = { background: '#0a1520', border: '1px solid #1e3a5f' };

const gifUrl = (path: string | null) =>
  path ? supabase.storage.from('warmups').getPublicUrl(path).data.publicUrl : null;

const buzz = (ms: number | number[]) => {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
};

function Thumb({ ex, accent }: { ex: Exercise; accent: string }) {
  const [failed, setFailed] = useState(false);
  const url = gifUrl(ex.gif_path);
  const box = { background: `${accent}1a`, border: `1px solid ${accent}33` };
  if (!url || failed) {
    return (
      <div className="flex-shrink-0 w-[68px] h-[68px] rounded-xl flex items-center justify-center text-2xl" style={box}>
        🏸
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="flex-shrink-0 w-[68px] h-[68px] rounded-xl object-cover"
      style={box}
    />
  );
}

// ── Full-screen guided routine ────────────────────────────────────────────────
function Routine({ list, accent, onExit }: { list: Exercise[]; accent: string; onExit: () => void }) {
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(list[0]?.duration_sec ?? 30);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const startedAt = useRef(Date.now());
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const ex = list[idx];
  const next = list[idx + 1];

  const goTo = useCallback((i: number) => {
    if (i >= list.length) { setDone(true); buzz([200, 100, 200]); return; }
    const j = Math.max(0, i);
    setIdx(j);
    setLeft(list[j].duration_sec);
  }, [list]);

  // Countdown: tick once a second; side effects live in the effect below so
  // React StrictMode's double-invoked updaters can't double-advance.
  useEffect(() => {
    if (paused || done) return;
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [paused, done]);

  useEffect(() => {
    if (done) return;
    if (left <= 0) { buzz(250); goTo(idx + 1); }
    else if (left <= 3) buzz(60);
  }, [left, idx, done, goTo]);

  // Keep the screen on while the routine is running
  useEffect(() => {
    const active = !paused && !done;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (active && nav.wakeLock) {
      nav.wakeLock.request('screen').then((l) => {
        if (cancelled) l.release().catch(() => {}); else wakeLock.current = l;
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      wakeLock.current?.release().catch(() => {});
      wakeLock.current = null;
    };
  }, [paused, done]);

  // Lock page scroll behind the overlay
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const overlay = 'fixed inset-0 z-[9999] flex flex-col px-5 pt-6 pb-8';
  const bg = { background: '#050b12' };

  if (done) {
    const secs = Math.round((Date.now() - startedAt.current) / 1000);
    return (
      <div className={`${overlay} items-center justify-center text-center gap-4`} style={bg}>
        <div className="text-5xl">🎉</div>
        <h2 className="text-2xl font-bold text-slate-100">All done!</h2>
        <p className="text-slate-400 text-sm">
          {list.length} exercises · {Math.floor(secs / 60)}m {secs % 60}s
        </p>
        <button
          onClick={onExit}
          className="mt-2 px-6 py-3 rounded-2xl font-semibold"
          style={{ color: accent, background: `${accent}1f`, border: `1px solid ${accent}55` }}
        >
          Back to exercises
        </button>
      </div>
    );
  }

  const url = gifUrl(ex.gif_path);
  const pct = 1 - left / ex.duration_sec;

  return (
    <div className={overlay} style={bg}>
      <div className="flex items-center justify-between text-slate-400 text-[13px]">
        <span>{idx + 1} / {list.length}</span>
        <button onClick={onExit} aria-label="Exit routine" className="p-2 -mr-2"><X size={22} /></button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0">
        {url && (
          <img
            src={url}
            alt={ex.name}
            className="w-full max-w-[380px] max-h-[45vh] object-contain rounded-2xl"
            style={{ border: `1px solid ${accent}33` }}
          />
        )}
        <h2 className="text-2xl font-bold text-slate-100 text-center">{ex.name}</h2>
        <div className="text-7xl font-bold tabular-nums" style={{ color: accent }}>{left}</div>
        <div className="w-full max-w-[380px] h-1.5 rounded-full overflow-hidden" style={{ background: '#1e3a5f' }}>
          <div className="h-full transition-all duration-1000 ease-linear" style={{ width: `${pct * 100}%`, background: accent }} />
        </div>
        <p className="text-slate-400 text-sm">{next ? `Next up: ${next.name}` : 'Last one!'}</p>
      </div>

      <div className="flex items-center justify-center gap-6">
        <button onClick={() => goTo(idx - 1)} disabled={idx === 0} aria-label="Previous" className="p-3 text-slate-300 disabled:opacity-30">
          <SkipBack size={28} />
        </button>
        <button
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? 'Resume' : 'Pause'}
          className="w-[72px] h-[72px] rounded-full flex items-center justify-center"
          style={{ background: accent, color: '#050b12' }}
        >
          {paused ? <Play size={32} /> : <Pause size={32} />}
        </button>
        <button onClick={() => goTo(idx + 1)} aria-label="Skip" className="p-3 text-slate-300">
          <SkipForward size={28} />
        </button>
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
export default function ExercisesTab() {
  const [mode, setMode] = useState<Mode>('warmup');
  const [part, setPart] = useState<string>('all');
  const [all, setAll] = useState<Exercise[] | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState<Exercise | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    const { data, error: err } = await supabase
      .from('warmup_exercises')
      .select('id, sort_order, name, body_part, duration_sec, gif_path')
      .order('sort_order');
    if (err) { setError(true); return; }
    setAll((data ?? []) as Exercise[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const isWarm = mode === 'warmup';
  const accent = isWarm ? WARM : COOL;

  const inMode = useMemo(
    () => (all ?? []).filter((e) => COOL_DOWN_NAMES.has(e.name) !== isWarm),
    [all, isWarm],
  );
  const parts = useMemo(
    () => BODY_PARTS.filter((p) => inMode.some((e) => e.body_part === p)),
    [inMode],
  );
  const list = part === 'all' ? inMode : inMode.filter((e) => e.body_part === part);
  const totalMin = Math.round(list.reduce((s, e) => s + e.duration_sec, 0) / 60);

  const switchMode = (m: Mode) => { setMode(m); setPart('all'); };

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* Intro */}
      <div>
        <h2 className="text-xl font-bold text-slate-100">Warm-up &amp; Stretches</h2>
        <p className="text-[13px] text-slate-400 mt-1 leading-snug">
          Loosen up before you play to move better and lower injury risk — then stretch after to recover.
        </p>
      </div>

      {/* Warm-up / Cool-down toggle */}
      <div className="flex gap-1 p-1 rounded-2xl" style={CARD}>
        <button
          onClick={() => switchMode('warmup')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
          style={isWarm
            ? { background: `${WARM}1f`, color: WARM, border: `1px solid ${WARM}55` }
            : { color: '#64748b', border: '1px solid transparent', background: 'transparent' }}
        >
          <Flame size={16} /> Warm-up
        </button>
        <button
          onClick={() => switchMode('cooldown')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
          style={!isWarm
            ? { background: `${COOL}1f`, color: COOL, border: `1px solid ${COOL}55` }
            : { color: '#64748b', border: '1px solid transparent', background: 'transparent' }}
        >
          <Snowflake size={16} /> Cool-down
        </button>
      </div>

      {/* Mode guidance */}
      <div
        className="text-[12px] rounded-xl px-3 py-2 leading-snug"
        style={{ color: accent, background: `${accent}14`, border: `1px solid ${accent}2e` }}
      >
        {isWarm
          ? 'Keep moving through these — 30 seconds each. Pick a body part or run the whole set.'
          : 'Hold each stretch for 30 seconds and breathe. Ease in gently — never stretch into pain.'}
      </div>

      {error && (
        <button onClick={load} className="w-full flex items-center justify-center gap-2 rounded-2xl p-4 text-[13px] text-slate-300" style={CARD}>
          <RotateCcw size={16} /> Couldn't load exercises. Tap to retry.
        </button>
      )}

      {!error && all === null && (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[94px] rounded-2xl animate-pulse" style={CARD} />
          ))}
        </div>
      )}

      {!error && all !== null && (
        <>
          {/* Body-part filter */}
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
            {['all', ...parts].map((p) => {
              const on = part === p;
              return (
                <button
                  key={p}
                  onClick={() => setPart(p)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all"
                  style={on
                    ? { color: accent, background: `${accent}1f`, border: `1px solid ${accent}55` }
                    : { color: '#94a3b8', background: '#0a1520', border: '1px solid #1e3a5f' }}
                >
                  {p === 'all' ? 'All' : label(p)}
                </button>
              );
            })}
          </div>

          {/* Start routine */}
          {list.length > 0 && (
            <button
              onClick={() => setRunning(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-[14px]"
              style={{ background: accent, color: '#050b12' }}
            >
              <Play size={18} /> Start {isWarm ? 'warm-up' : 'cool-down'} · {list.length} exercises · ~{totalMin} min
            </button>
          )}

          {/* Exercise list */}
          {list.length === 0 ? (
            <p className="text-center text-[13px] text-slate-500 py-6">No exercises here yet.</p>
          ) : (
            <div className="space-y-2.5">
              {list.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => ex.gif_path && setZoom(ex)}
                  className="w-full text-left flex items-center gap-3 rounded-2xl p-3"
                  style={CARD}
                >
                  <Thumb ex={ex} accent={accent} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-100 text-[14px] leading-tight">{ex.name}</div>
                    <div className="text-[12px] text-slate-500 mt-0.5">{label(ex.body_part)}</div>
                  </div>
                  <span
                    className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{ color: accent, background: `${accent}1a`, border: `1px solid ${accent}33` }}
                  >
                    {ex.duration_sec}s
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <p className="text-[11px] text-slate-500 text-center pt-1 leading-snug">
        Ease into every movement and stop if anything hurts. General guidance, not medical advice.
      </p>

      {zoom && gifUrl(zoom.gif_path) && (
        <AvatarLightbox url={gifUrl(zoom.gif_path)!} name={zoom.name} onClose={() => setZoom(null)} />
      )}
      {running && <Routine list={list} accent={accent} onExit={() => setRunning(false)} />}
    </div>
  );
}
