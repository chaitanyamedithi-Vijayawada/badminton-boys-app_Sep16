import { useEffect } from 'react';

interface Props {
  url: string;
  name: string;
  onClose: () => void;
}

// Full-screen popup that shows a player's photo enlarged. Tap anywhere (or press
// Escape) to close. Rendered by PlayerAvatar when `enlargeable` is set and the
// player has a photo.
export default function AvatarLightbox({ url, name, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
      }}
    >
      <img
        src={url}
        alt={name}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 'min(88vw, 420px)', maxHeight: '70vh',
          width: 'auto', height: 'auto', borderRadius: 20,
          objectFit: 'contain', border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      />
      <div style={{ color: '#f0f0f5', fontSize: 18, fontWeight: 600 }}>{name}</div>
      <div style={{ color: '#8b93a7', fontSize: 12 }}>Tap anywhere to close</div>
    </div>
  );
}