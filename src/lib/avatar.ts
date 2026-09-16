// ── Avatar helpers ────────────────────────────────────────────────────────────
// Shared by the profile menu (self-upload) and the Players tab (admin uploading
// on another player's behalf). Extracted so both paths use one implementation
// rather than drifting copies.

import { supabase } from './supabase';

/** Cover-crop an image to a square and scale it down to maxDim px, as JPEG. */
export function resizeImage(file: File, maxDim = 256): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = maxDim;
        canvas.height = maxDim;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, sx, sy, min, min, 0, 0, maxDim, maxDim);
        canvas.toBlob(
          blob => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

/** Player name → safe storage filename. Each player has one slot they overwrite. */
export function avatarPathFor(playerName: string): string {
  const safe = playerName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${safe}.jpg`;
}

/** Basic client-side guardrails before we hand a file to the resizer. */
export function validateAvatarFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file';
  if (file.size > 10 * 1024 * 1024) return 'Image must be under 10 MB';
  return null;
}

/**
 * Upload an avatar for `playerName` and store the public URL on their row.
 * Works for self-upload and for an admin uploading on someone else's behalf.
 */
export async function uploadAvatarFor(playerName: string, file: File): Promise<void> {
  const invalid = validateAvatarFile(file);
  if (invalid) throw new Error(invalid);

  const path = avatarPathFor(playerName);
  const blob = await resizeImage(file, 256);

  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the new photo replaces the old one in the UI immediately.
  const cacheBustedUrl = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: dbErr } = await supabase
    .from('players')
    .update({ avatar_url: cacheBustedUrl })
    .eq('name', playerName);
  if (dbErr) throw dbErr;
}

/** Remove a player's avatar from storage and clear it on their row. */
export async function removeAvatarFor(playerName: string): Promise<void> {
  await supabase.storage.from('avatars').remove([avatarPathFor(playerName)]);
  const { error } = await supabase
    .from('players')
    .update({ avatar_url: null })
    .eq('name', playerName);
  if (error) throw error;
}