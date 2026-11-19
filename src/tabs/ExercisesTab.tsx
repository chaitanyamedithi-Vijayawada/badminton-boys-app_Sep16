import { useState } from 'react';
import { Flame, Snowflake, PlayCircle } from 'lucide-react';

// Static, curated warm-up (pre-game) and cool-down (post-game) routines for
// badminton. Each item links out to a YouTube demo search — no media is hosted
// or bundled, so there's nothing to load or store and the app stays light.

interface Exercise {
  emoji: string;
  name: string;
  meta: string; // duration / reps
  q: string;    // YouTube demo search query
}

const WARM_UP: Exercise[] = [
  { emoji: '🏃', name: 'Light Jog / Skipping', meta: '3–5 min', q: 'skipping rope warm up' },
  { emoji: '🔄', name: 'Arm Circles', meta: '30s each way', q: 'arm circles warm up exercise' },
  { emoji: '🙌', name: 'Shoulder Rolls', meta: '30s', q: 'shoulder rolls exercise' },
  { emoji: '✋', name: 'Wrist & Forearm Rotations', meta: '30s', q: 'wrist warm up exercise badminton' },
  { emoji: '🦵', name: 'Leg Swings', meta: '10 each leg', q: 'leg swings warm up' },
  { emoji: '🤸', name: 'Lunge with Twist', meta: '8 each side', q: 'lunge with twist warm up' },
  { emoji: '⚡', name: 'High Knees & Butt Kicks', meta: '30s each', q: 'high knees butt kicks warm up' },
  { emoji: '↔️', name: 'Side Shuffles', meta: '1 min', q: 'side shuffle agility drill' },
  { emoji: '🏸', name: 'Shadow Swings', meta: '1–2 min', q: 'badminton shadow swing footwork' },
];

const COOL_DOWN: Exercise[] = [
  { emoji: '🧍', name: 'Calf Stretch', meta: '30s each', q: 'calf stretch how to' },
  { emoji: '🦵', name: 'Quad Stretch', meta: '30s each', q: 'standing quad stretch' },
  { emoji: '🤸', name: 'Hamstring Stretch', meta: '30s each', q: 'hamstring stretch how to' },
  { emoji: '🏃', name: 'Hip Flexor Lunge', meta: '30s each', q: 'hip flexor stretch lunge' },
  { emoji: '💪', name: 'Cross-Body Shoulder', meta: '30s each', q: 'cross body shoulder stretch' },
  { emoji: '🙆', name: 'Triceps Stretch', meta: '30s each', q: 'triceps stretch overhead' },
  { emoji: '✋', name: 'Wrist Flexor / Extensor', meta: '30s each', q: 'wrist flexor extensor stretch' },
  { emoji: '🚪', name: 'Chest / Doorway', meta: '30s', q: 'doorway chest stretch' },
  { emoji: '🌀', name: 'Spinal Twist', meta: '30s each', q: 'spinal twist stretch' },
  { emoji: '🚶', name: 'Walk & Breathe', meta: '2 min', q: 'cool down breathing exercise' },
];

type Mode = 'warmup' | 'cooldown';

const WARM = '#f59e0b'; // amber
const COOL = '#38bdf8'; // sky

const demoUrl = (q: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

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
          Tap any exercise to watch a quick demo.
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

      {/* Exercise list — each card links to a demo */}
      <div className="space-y-2.5">
        {list.map((ex, i) => (
          <a
            key={ex.name}
            href={demoUrl(ex.q)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-2xl p-3.5 no-underline transition-opacity active:opacity-70"
            style={{ background: '#0a1520', border: '1px solid #1e3a5f' }}
          >
            <div
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg relative"
              style={{ background: `${accent}1a`, border: `1px solid ${accent}33` }}
            >
              <span>{ex.emoji}</span>
              <span
                className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-950"
                style={{ background: accent }}
              >
                {i + 1}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-100 text-[14px] leading-tight">{ex.name}</div>
              <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                <PlayCircle size={12} />
                <span>Watch demo</span>
              </div>
            </div>

            <span
              className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
              style={{ color: accent, background: `${accent}1a`, border: `1px solid ${accent}33` }}
            >
              {ex.meta}
            </span>
          </a>
        ))}
      </div>

      <p className="text-[11px] text-slate-500 text-center pt-1 leading-snug">
        Ease into every movement and stop if anything hurts. General guidance, not medical advice.
      </p>
    </div>
  );
}
