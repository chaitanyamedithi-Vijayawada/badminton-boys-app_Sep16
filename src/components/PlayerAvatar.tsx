// src/components/PlayerAvatar.tsx
//
// Render an avatar for a player. Shows the uploaded photo if available,
// otherwise falls back to the existing colored initials circle (or emoji,
// matching the profile screen). Used wherever the app previously rendered a
// plain initials circle: RSVP list, Player Transfers, All Balances, etc.
//
// IMPORTANT: keep this in sync with the avatar in Header.tsx (profile modal)
// so the visual is consistent across the app.

import { useState } from 'react';
import type { Player } from '../types';
import AvatarLightbox from './AvatarLightbox';

interface Props {
  player?: Pick<Player, 'name' | 'color' | 'initials' | 'emoji' | 'avatar_url'> | null;
  // The fallback used when there's no player record at all (e.g. guests). Just
  // a name plus optional color, used to render the initials circle.
  fallbackName?: string;
  fallbackBg?: string;
  fallbackFg?: string;
  size?: number;          // px square — default 32
  border?: boolean;       // show subtle border (default true)
  emojiSize?: number;     // override emoji font size; defaults to ~60% of size
  className?: string;
  title?: string;
  enlargeable?: boolean;   // tap to view the photo full-size (only when a photo exists)
}

export default function PlayerAvatar({
  player,
  fallbackName,
  fallbackBg,
  fallbackFg,
  size = 32,
  border = true,
  emojiSize,
  className,
  title,
  enlargeable = false,
}: Props) {
  const [showLightbox, setShowLightbox] = useState(false);
  const photo = player?.avatar_url;
  const emoji = player?.emoji;
  const initials = player?.initials || makeFallbackInitials(fallbackName ?? player?.name ?? '');
  const bg = player?.color?.bg ?? fallbackBg ?? 'rgba(100,100,100,0.25)';
  const fg = player?.color?.fg ?? fallbackFg ?? '#cbd5e1';

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(8, Math.round(size * 0.35)),
    background: photo ? '#0f172a' : bg,
    color: fg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: emoji ? (emojiSize ?? Math.round(size * 0.6)) : Math.round(size * 0.42),
    fontWeight: 700,
    border: border ? '1px solid rgba(255,255,255,0.08)' : 'none',
    overflow: 'hidden',
    flexShrink: 0,
    padding: 0,
  };

  return (
    <>
      <div
        className={className}
        style={{ ...baseStyle, cursor: photo && enlargeable ? 'pointer' : baseStyle.cursor }}
        title={title ?? player?.name}
        onClick={photo && enlargeable ? (e) => { e.stopPropagation(); setShowLightbox(true); } : undefined}
      >
        {photo ? (
          <img
            src={photo}
            alt={player?.name ?? ''}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <>{emoji || initials}</>
        )}
      </div>
      {showLightbox && photo && (
        <AvatarLightbox url={photo} name={player?.name ?? ''} onClose={() => setShowLightbox(false)} />
      )}
    </>
  );
}

// Mini initials helper for callers that don't have a player record (e.g.
// guests). Mirrors makeInitials in constants.ts but kept inline so this
// component has no external dependency.
function makeFallbackInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}