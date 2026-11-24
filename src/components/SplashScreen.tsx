import { useEffect, useRef, useState } from 'react';

// CourtCrew animated splash: plays the logo animation once, then fades into the
// app. Players with "Reduce Motion" on see the still logo instead. If the video
// can't play (old browser, data saver), a timer still lets the app open.
const BG = '#171e1f';           // matches the animation's own background
const STILL_MS = 1200;          // how long the still logo shows
const MAX_MS = 4500;            // hard cap so the splash can never get stuck

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const finished = useRef(false);
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    setFading(true);
    setTimeout(onDone, 500);
  };

  useEffect(() => {
    const t = setTimeout(finish, reduceMotion ? STILL_MS : MAX_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999, background: BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: fading ? 0 : 1, transition: 'opacity 0.5s ease',
    }}>
      {reduceMotion ? (
        <img src="/brand/splash-poster.jpg" alt="CourtCrew"
          style={{ width: '100%', maxWidth: 640, height: 'auto' }} />
      ) : (
        <video
          autoPlay muted playsInline preload="auto"
          poster="/brand/splash-poster.jpg"
          onEnded={finish}
          onError={finish}
          aria-label="CourtCrew"
          style={{ width: '100%', maxWidth: 640, height: 'auto' }}
        >
          <source src="/brand/splash.webm" type="video/webm" />
          <source src="/brand/splash.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  );
}
