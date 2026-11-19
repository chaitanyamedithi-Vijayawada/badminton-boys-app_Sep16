import { useState } from 'react';
import { Flame, Snowflake } from 'lucide-react';

// Static, curated warm-up (pre-game) and cool-down (post-game) routines for
// badminton. No data layer — it's reference content, so nothing to load or store.

interface Exercise {
  emoji: string;
  name: string;
  meta: string; // duration / reps
  desc: string;
}

const WARM_UP: Exercise[] = [
  { emoji: '🏃', name: 'Light Jog / Skipping', meta: '3–5 min', desc: 'Jog or skip around the court to raise your heart rate and warm the muscles.' },
  { emoji: '🔄', name: 'Arm Circles', meta: '30s each way', desc: 'Big forward then backward circles to open up the shoulders.' },
  { emoji: '🙌', name: 'Shoulder Rolls', meta: '30s', desc: 'Roll the shoulders up, back and down — stay loose and relaxed.' },
  { emoji: '✋', name: 'Wrist & Forearm Rotations', meta: '30s', desc: 'Circle the wrists both ways and gently flex/extend — key for racket control.' },
  { emoji: '🦵', name: 'Leg Swings', meta: '10 each leg', desc: 'Front-to-back and side-to-side swings; hold a wall for balance.' },
  { emoji: '🤸', name: 'Lunge with Twist', meta: '8 each side', desc: 'Step into a lunge and rotate your torso over the front leg.' },
  { emoji: '⚡', name: 'High Knees & Butt Kicks', meta: '30s each', desc: 'Drive the knees up, then heels to glutes, to fire up the legs.' },
  { emoji: '↔️', name: 'Side Shuffles', meta: '1 min', desc: 'Shuffle side to side in a low stance to prime lateral movement.' },
  { emoji: '🏸', name: 'Shadow Swings', meta: '1–2 min', desc: 'Mimic clears, drops and smashes with no shuttle to groove the motion.' },
];

const COOL_DOWN: Exercise[] = [
  { emoji: '🧍', name: 'Calf Stretch', meta: '30s each', desc: 'Hands on a wall, back leg straight, heel pressed down.' },
  { emoji: '🦵', name: 'Quad Stretch', meta: '30s each', desc: 'Pull one heel toward your glute, knees together, stand tall.' },
  { emoji: '🤸', name: 'Hamstring Stretch', meta: '30s each', desc: 'Extend one leg, hinge at the hips, reach gently toward the toes.' },
  { emoji: '🏃', name: 'Hip Flexor Lunge', meta: '30s each', desc: 'Drop into a low lunge and tuck the hips under to open the back hip.' },
  { emoji: '💪', name: 'Cross-Body Shoulder', meta: '30s each', desc: 'Draw one arm across your chest and hold it with the other.' },
  { emoji: '🙆', name: 'Triceps Stretch', meta: '30s each', desc: 'Reach a hand down your back and gently press the elbow.' },
  { emoji: '✋', name: 'Wrist Flexor / Extensor', meta: '30s each', desc: 'Arm straight out — gently pull the fingers back, then down.' },
  { emoji: '🚪', name: 'Chest / Doorway', meta: '30s', desc: 'Forearm on a frame, step through to open the chest.' },
  { emoji: '🌀', name: 'Spinal Twist', meta: '30s each', desc: 'Seated or standing, rotate gently through the spine and hold.' },
  { emoji: '🚶', name: 'Walk & Breathe', meta: '2 min', desc: 'Slow walk with deep breaths to bring the heart rate back down.' },
];

type Mode = 'warmup' | 'cooldown';

const WARM = '#f59e0b'; // amber
const COOL = '#38bdf8'; // sky

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
        {list.map((ex, i) => (
          <div
            key={ex.name}
            className="flex gap-3 rounded-2xl p-3.5"
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
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-slate-100 text-[14px] leading-tight">{ex.name}</span>
                <span
                  className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ color: accent, background: `${accent}1a`, border: `1px solid ${accent}33` }}
                >
                  {ex.meta}
                </span>
              </div>
              <p className="text-[12.5px] text-slate-400 leading-snug mt-1">{ex.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-500 text-center pt-1 leading-snug">
        Ease into every movement and stop if anything hurts. General guidance, not medical advice.
      </p>
    </div>
  );
}
