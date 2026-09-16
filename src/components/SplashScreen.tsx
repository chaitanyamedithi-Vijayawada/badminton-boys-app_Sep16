import { useEffect, useState } from 'react';

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 800);
    const t2 = setTimeout(() => setPhase('out'), 2500);
    const t3 = setTimeout(() => onDone(), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: '#040a10',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 24,
      opacity: phase === 'out' ? 0 : 1,
      transition: phase === 'out' ? 'opacity 0.7s ease' : 'none',
    }}>
      <style>{`
        @keyframes scaleIn {
          0% { transform: scale(0.6); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pulseGlow {
          0%, 100% { filter: drop-shadow(0 0 12px color-mix(in srgb, var(--accent) 30%, transparent)); }
          50% { filter: drop-shadow(0 0 32px color-mix(in srgb, var(--accent) 70%, transparent)) drop-shadow(0 0 60px color-mix(in srgb, var(--accent-from) 30%, transparent)); }
        }
        @keyframes fadeUp {
          0% { opacity: 0; transform: translateY(16px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes dotBounce {
          0%, 100% { transform: translateY(0); opacity: 0.3; }
          50% { transform: translateY(-8px); opacity: 1; }
        }
        @keyframes ringsExpand {
          0% { transform: scale(0.8); opacity: 0.6; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes barFill {
          0% { width: 0%; }
          100% { width: 90%; }
        }
      `}</style>

      {/* Ripple rings behind logo */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          position: 'absolute', width: 200, height: 200, borderRadius: '50%',
          border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
          animation: 'ringsExpand 2s ease-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 200, height: 200, borderRadius: '50%',
          border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)',
          animation: 'ringsExpand 2s ease-out 0.6s infinite',
        }} />
        <div style={{
          position: 'absolute', width: 200, height: 200, borderRadius: '50%',
          border: '1px solid color-mix(in srgb, var(--accent) 8%, transparent)',
          animation: 'ringsExpand 2s ease-out 1.2s infinite',
        }} />

        {/* Logo */}
        <img
          src="/17136e7b-a3eb-407f-a161-d5cc2705afab.png"
          alt="Badminton Boys"
          style={{
            width: 200, height: 200,
            objectFit: 'contain',
            animation: 'scaleIn 0.8s cubic-bezier(0.34,1.56,0.64,1) both, pulseGlow 2.5s ease-in-out 0.8s infinite',
            position: 'relative', zIndex: 2,
          }}
        />
      </div>

      {/* Title */}
      <div style={{
        textAlign: 'center',
        animation: 'fadeUp 0.7s ease 0.6s both',
      }}>
        <div style={{
          fontSize: 26, fontWeight: 900, letterSpacing: '0.2em',
          textTransform: 'uppercase',
          background: 'linear-gradient(90deg, var(--accent), #ff6f91, var(--accent))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Badminton Boys
        </div>
        <div style={{
          fontSize: 11, color: '#1e4a5f', letterSpacing: '0.14em',
          textTransform: 'uppercase', marginTop: 6,
        }}>
          Surrey · Langley BC
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        width: 140, height: 2, background: '#0f2027',
        borderRadius: 99, overflow: 'hidden',
        animation: 'fadeUp 0.6s ease 0.9s both',
      }}>
        <div style={{
          height: '100%',
          background: 'linear-gradient(90deg, var(--accent), #ff6f91)',
          borderRadius: 99,
          animation: 'barFill 2.5s ease-in-out both',
        }} />
      </div>

      {/* Bouncing dots */}
      <div style={{ display: 'flex', gap: 8, animation: 'fadeUp 0.6s ease 1s both' }}>
        {[0, 0.2, 0.4].map((delay, i) => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: '50%',
            background: i === 1 ? '#ff6f91' : 'var(--accent)',
            animation: `dotBounce 1.2s ease-in-out ${delay}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}