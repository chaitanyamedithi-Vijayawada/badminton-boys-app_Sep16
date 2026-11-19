import { useState } from 'react';
import { Flame, Snowflake } from 'lucide-react';

// Static, curated warm-up (pre-game) and cool-down (post-game) routines for
// badminton. Each item shows an illustration from /exercises/<slug>.webp.
// Images are served on-demand from the app's public folder (kept out of the PWA
// precache by using .webp), and fall back to the emoji if an image isn't there
// yet — so the tab is never broken while artwork is being added.

interface Exercise {
  slug: string;
  emoji: string;
  name: string;
  meta: string; // duration / reps
}

const WARM_UP: Exercise[] = [
  { slug: 'light-jog',         emoji: '🏃', name: 'Light Jog / Skipping',       meta: '3–5 min' },
  { slug: 'arm-circles',       emoji: '🔄', name: 'Arm Circles',                meta: '30s each way' },
  { slug: 'shoulder-rolls',    emoji: '🙌', name: 'Shoulder Rolls',             meta: '30s' },
  { slug: 'wrist-rotations',   emoji: '✋', name: 'Wrist & Forearm Rotations',  meta: '30s' },
  { slug: 'leg-swings',        emoji: '🦵', name: 'Leg Swings',                 meta: '10 each leg' },
  { slug: 'lunge-twist',       emoji: '🤸', name: 'Lunge with Twist',           meta: '8 each side' },
  { slug: 'high-knees',        emoji: '⚡', name: 'High Knees & Butt Kicks',    meta: '30s each' },
  { slug: 'side-shuffles',     emoji: '↔️', name: 'Side Shuffles',              meta: '1 min' },
  { slug: 'shadow-swings',     emoji: '🏸', name: 'Shadow Swings',              meta: '1–2 min' },
];

const COOL_DOWN: Exercise[] = [
  { slug: 'calf-stretch',        emoji: '🧍', name: 'Calf Stretch',            meta: '30s each' },
  { slug: 'quad-stretch',        emoji: '🦵', name: 'Quad Stretch',            meta: '30s each' },
  { slug: 'hamstring-stretch',   emoji: '🤸', name: 'Hamstring Stretch',       meta: '30s each' },
  { slug: 'hip-flexor',          emoji: '🏃', name: 'Hip Flexor Lunge',        meta: '30s each' },
  { slug: 'cross-body-shoulder', emoji: '💪', name: 'Cross-Body Shoulder',     meta: '30s each' },
  { slug: 'triceps-stretch',     emoji: '🙆', name: 'Triceps Stretch',         meta: '30s each' },
  { slug: 'wrist-stretch',       emoji: '✋', name: 'Wrist Flexor / Extensor',  meta: '30s each' },
  { slug: 'chest-doorway',       emoji: '🚪', name: 'Chest / Doorway',         meta: '30s' },
  { slug: 'spinal-twist',        emoji: '🌀', name: 'Spinal Twist',            meta: '30s each' },
  { slug: 'walk-breathe',        emoji: '🚶', name: 'Walk & Breathe',          meta: '2 min' },
];

type Mode = 'warmup' | 'cooldown';

const WARM = '#f59e0b'; // amber
const COOL = '#38bdf8'; // sky

function Thumb({ slug, emoji, accent }: { slug: string; emoji: string; accent: string }) {
  const [failed, setFailed] = useState(false);
  const boxStyle = { background: `${accent}1a`, border: `1px solid ${accent}33` };

  if (failed) {
    return (
      <div
        className="flex-shrink-0 w-[68px] h-[68px] rounded-xl flex items-center justify-center text-2xl"
        style={boxStyle}
      >
        {emoji}
      </div>
    );
  }
  return (
    <img
      src={`/exercises/${slug}.webp`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="flex-shrink-0 w-[68px] h-[68px] rounded-xl object-cover"
      style={boxStyle}
    />
  );
}

export default function ExercisesTab() {
  const [mode, setMode] = useState<Mode>('warmup');
  const isWarm = mode === 'warmup';
  const list = isWarm ? WARM_UP : COOL_DOWN;
  const accent = isWarm ? WARM : COOL;

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
      <div className="flex gap-1 p-1 rounded-2xl" style={{ background: '#0a1520', border: '1px solid #1e3a5f' }}>
        <button
          onClick={() => setMode('warmup')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
          style={isWarm
            ? { background: `${WARM}1f`, color: WARM, border: `1px solid ${WARM}55` }
            : { color: '#64748b', border: '1px solid transparent', background: 'transparent' }}
        >
          <Flame size={16} /> Warm-up
        </button>
        <button
          onClick={() => setMode('cooldown')}
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
          ? 'Keep moving through these — dynamic, about 8–10 minutes total before you play.'
          : 'Hold each stretch 20–30 seconds and breathe. Ease in gently — never stretch into pain.'}
      </div>

      {/* Exercise list */}
      <div className="space-y-2.5">
        {list.map((ex) => (
          <div
            key={ex.slug}
            className="flex items-center gap-3 rounded-2xl p-3"
            style={{ background: '#0a1520', border: '1px solid #1e3a5f' }}
          >
            <Thumb slug={ex.slug} emoji={ex.emoji} accent={accent} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-100 text-[14px] leading-tight">{ex.name}</div>
            </div>
            <span
              className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
              style={{ color: accent, background: `${accent}1a`, border: `1px solid ${accent}33` }}
            >
              {ex.meta}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-500 text-center pt-1 leading-snug">
        Ease into every movement and stop if anything hurts. General guidance, not medical advice.
      </p>
    </div>
  );
}
