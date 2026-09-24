import { Player, PlayerColor } from '../types';
import { getPacificNow } from './cutoff';

export const COLORS: PlayerColor[] = [
  { bg: 'rgba(29,158,117,0.2)', fg: '#5DCAA5' },
  { bg: 'rgba(55,138,221,0.2)', fg: '#85B7EB' },
  { bg: 'rgba(186,117,23,0.2)', fg: '#FAC775' },
  { bg: 'rgba(83,74,183,0.2)', fg: '#7F77DD' },
  { bg: 'rgba(216,90,48,0.2)', fg: '#F0997B' },
  { bg: 'rgba(99,153,34,0.2)', fg: '#97C459' },
  { bg: 'rgba(212,83,126,0.2)', fg: '#ED93B1' },
  { bg: 'rgba(136,135,128,0.2)', fg: '#B4B2A9' },
  { bg: 'rgba(226,75,74,0.2)', fg: '#F09595' },
];

export const INITIAL_PLAYERS: { name: string; balance: number }[] = [
  { name: 'Aakash', balance: 60.14 },
  { name: 'Anand', balance: 95.77 },
  { name: 'Arun', balance: 50.00 },
  { name: 'Ashok', balance: 22.89 },
  { name: 'Bharath', balance: 66.99 },
  { name: 'Chaitanya', balance: 69.01 },
  { name: 'Eswar', balance: 80.04 },
  { name: 'Jagdeesh', balance: 56.34 },
  { name: 'Jatinder', balance: 40.91 },
  { name: 'Malli', balance: 98.90 },
  { name: 'Maruthi Dr', balance: 28.41 },
  { name: 'Nag', balance: 59.81 },
  { name: 'Navan', balance: 54.12 },
  { name: 'Raghu', balance: 39.35 },
  { name: 'Rakesh', balance: 28.67 },
  { name: 'Ram', balance: 82.89 },
  { name: 'Ravi', balance: 6.52 },
  { name: 'Sachin', balance: 37.11 },
  { name: 'Sai', balance: 31.77 },
  { name: 'Sandeep', balance: 27.10 },
  { name: 'Shailesh', balance: 40.62 },
  { name: 'Siva', balance: 128.37 },
  { name: 'Srinivas', balance: 58.33 },
  { name: 'Subash', balance: 30.28 },
  { name: 'SandeepParchuri', balance: 42.42 },
  { name: 'Vamsi', balance: 107.56 },
];

export function buildPlayers(balanceMap?: Record<string, number>): Player[] {
  return INITIAL_PLAYERS.map((p, i) => {
    const color = COLORS[i % COLORS.length];
    const initials = p.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    const balance = balanceMap ? (balanceMap[p.name] ?? p.balance) : p.balance;
    return { name: p.name, skill: null, balance, color, initials };
  });
}

export function makeInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function getPlayerColor(_name: string, index: number): PlayerColor {
  return COLORS[index % COLORS.length];
}

// ── Split-court sessions ──────────────────────────────────────────────────────
// Some sessions use a different number of courts for different parts of the
// session (e.g. 3 courts for the first hour, 4 courts for the second). When the
// admin enables "split court" for a day, the cost is the sum of court-hours
// across the segments, instead of a flat courts × hours.
export interface CourtSplitSegment { courts: number; hours: number; }
export interface CourtSplit { enabled: boolean; segments: CourtSplitSegment[]; }

export const DEFAULT_COURT_SPLIT: CourtSplit = {
  enabled: false,
  segments: [{ courts: 3, hours: 1 }, { courts: 4, hours: 1 }],
};

export function parseCourtSplit(raw?: string | null): CourtSplit | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { enabled?: unknown; segments?: unknown };
    if (!o || !Array.isArray(o.segments)) return null;
    const segments = (o.segments as { courts?: unknown; hours?: unknown }[])
      .map(s => ({ courts: Number(s.courts) || 0, hours: Number(s.hours) || 0 }))
      .filter(s => s.courts > 0 && s.hours > 0);
    return { enabled: !!o.enabled, segments };
  } catch {
    return null;
  }
}

// Total court-hours across all segments (e.g. 3×1 + 4×1 = 7).
export function courtSplitCourtHours(split: CourtSplit | null): number {
  if (!split || !split.enabled || split.segments.length === 0) return 0;
  return split.segments.reduce((sum, s) => sum + s.courts * s.hours, 0);
}

// Largest court count used in any segment (for the "N courts" display).
export function courtSplitMaxCourts(split: CourtSplit | null): number {
  if (!split || split.segments.length === 0) return 0;
  return Math.max(...split.segments.map(s => s.courts));
}

// Total wall-clock hours of the session (sum of segment hours).
export function courtSplitTotalHours(split: CourtSplit | null): number {
  if (!split || split.segments.length === 0) return 0;
  return split.segments.reduce((sum, s) => sum + s.hours, 0);
}

export function getWeekKey(): string {
  // Anchored to Pacific time so the week is identical for every player
  // regardless of their device's timezone.
  const now = getPacificNow();
  const day = now.getDay();
  const daysUntilSat = (6 - day + 7) % 7;
  const thisSat = new Date(now);
  thisSat.setDate(now.getDate() + daysUntilSat);
  const yyyy = thisSat.getFullYear();
  const mm = String(thisSat.getMonth() + 1).padStart(2, '0');
  const dd = String(thisSat.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// The week key of the upcoming Sat/Wed session for a given day type. Unlike
// getWeekKey(), this ROLLS FORWARD 7 days as soon as the day's session end
// time has passed in Pacific — so Wednesday's tab immediately advances to
// next week's Wednesday after this Wednesday ends 8 PM Pacific, and same
// for Saturday after 9 AM. Used by the Home tab for RSVP display/writes,
// guest inserts, and settings lookups so the "voting window" is 6 days
// wide instead of 2. Cutoffs/finalize/history continue to use getWeekKey()
// so those behaviors are unchanged.
export function getUpcomingSessionWeekKey(day: 'saturday' | 'wednesday'): string {
  const now = getPacificNow();
  const dow = now.getDay();
  const thisSat = new Date(now);
  thisSat.setHours(0, 0, 0, 0);
  const daysUntilSat = (6 - dow + 7) % 7;
  thisSat.setDate(thisSat.getDate() + daysUntilSat);

  // Session end time in Pacific — Sat 9 AM, Wed 8 PM.
  const thisSessionDate = new Date(thisSat);
  if (day === 'wednesday') thisSessionDate.setDate(thisSat.getDate() - 3);
  const sessionEnd = new Date(thisSessionDate);
  if (day === 'saturday') sessionEnd.setHours(9, 0, 0, 0);
  else                    sessionEnd.setHours(20, 0, 0, 0);

  // Roll forward the week's Saturday only once this day's session ended at
  // least 2 hours ago — i.e. when it finalizes. Keeping the just-played
  // session in view for the full 2-hour window is what makes the review/edit
  // window usable (add/remove players, then finalize) instead of the session
  // vanishing the moment it ends.
  if (now.getTime() >= sessionEnd.getTime() + 2 * 60 * 60 * 1000) {
    thisSat.setDate(thisSat.getDate() + 7);
  }
  const yyyy = thisSat.getFullYear();
  const mm = String(thisSat.getMonth() + 1).padStart(2, '0');
  const dd = String(thisSat.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// The week key for the session that was most recently played (or is being
// played right now). This is the week key used for finalization and
// alreadyCompleted checks. On Sunday (dow 0) it points to the Saturday that
// just passed, not next Saturday — so a session finalized on Sunday is
// recorded against the correct week. This must match getCurrentWeekKey() in
// cutoff.ts.
export function getCompletedWeekKey(): string {
  const now = getPacificNow();
  const dow = now.getDay(); // 0=Sun … 6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const sat = new Date(now);
  sat.setHours(0, 0, 0, 0);
  sat.setDate(sat.getDate() + mondayOffset + 5);
  const yyyy = sat.getFullYear();
  const mm = String(sat.getMonth() + 1).padStart(2, '0');
  const dd = String(sat.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}



export function getNextWeekday(dayNum: number): Date {
  // Anchored to Pacific time. Must stay aligned with getWeekKey() — both
  // functions use the same "daysUntilSat" logic so the displayed session date
  // always matches the week key that RSVPs are saved under. The old logic had
  // special-case branches for Saturday evening / Sunday / Monday that drifted
  // out of sync with getWeekKey, showing the wrong session date.
  const today = getPacificNow();
  const dow = today.getDay(); // 0=Sun … 6=Sat
  const result = new Date(today);
  result.setHours(0, 0, 0, 0);

  // Replicate getWeekKey: the Saturday that anchors the current RSVP week.
  const daysUntilSat = (6 - dow + 7) % 7;
  const sat = new Date(result);
  sat.setDate(result.getDate() + daysUntilSat);

  if (dayNum === 6) {
    return sat;
  } else if (dayNum === 3) {
    // Wednesday is 3 days before the week-key Saturday.
    const wed = new Date(sat);
    wed.setDate(sat.getDate() - 3);
    return wed;
  } else {
    // Generic fallback for any other weekday.
    const diff = (dayNum - dow + 7) % 7;
    result.setDate(result.getDate() + diff);
    return result;
  }
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export type ThemeId = 'aurora' | 'tideglow' | 'verdant' | 'emberlight' | 'nightcourt';

export interface ThemeConfig {
  id: ThemeId;
  label: string;
  emoji: string;
  // Backwards-compatible cosmetic fields used by the theme picker swatches.
  bgGradient: string;
  cardBorder: string;
  accent: string;
  navBorder: string;
  navBg: string;
  swatchGradient: string;
  topColor: string;
  textPrimary: string;
  cardBg: string;
  // New: full set of CSS var values applyTheme writes onto :root so the
  // whole UI (cards, buttons, accents) actually shifts when you switch theme.
  vars: {
    bgGradient: string;
    topColor: string;
    navBg: string;
    navBorder: string;
    textPrimary: string;
    accent: string;
    accent2: string;          // secondary hue (glows, dual-tone gradients)
    accentFrom: string;       // primary button gradient start
    accentTo: string;         // primary button gradient end
    accentText: string;
    cardBg: string;           // base card surface
    cardBorder: string;
    cardTint1: string;        // left/top tint stop on card gradient
    cardTint2: string;        // right/bottom tint stop on card gradient
    cardShadow: string;       // glow under cards
    cardAccent1: string;      // tinted border for card-cyan/emerald/amber/pink variants
    cardAccent2: string;      // tinted border for card-lime/rose/sky/purple variants
  };
}

// Four mood-distinct dark themes. Each picks two complementary accent hues
// so the gradient buttons, card tints, and ambient glow all rotate together
// — switching theme genuinely changes the feel of the UI, not just the
// wallpaper.
export const THEMES: ThemeConfig[] = [
  {
    id: 'aurora',
    label: 'Aurora',
    emoji: '🌌',
    bgGradient:
      'radial-gradient(800px 800px at 5% 5%, rgba(124,92,255,0.55) 0%, transparent 70%),' +
      'radial-gradient(700px 700px at 95% 8%, rgba(196,77,219,0.42) 0%, transparent 68%),' +
      'radial-gradient(650px 650px at 50% 50%, rgba(124,92,255,0.18) 0%, transparent 72%),' +
      'radial-gradient(500px 500px at 88% 88%, rgba(255,111,145,0.22) 0%, transparent 65%),' +
      'linear-gradient(160deg, #1d1640 0%, #15102b 45%, #120d26 100%)',
    cardBorder: 'rgba(124,92,255,0.20)',
    accent: '#7c5cff',
    navBorder: 'rgba(255,255,255,0.10)',
    navBg: 'rgba(20,14,40,0.92)',
    swatchGradient: 'linear-gradient(135deg, #3d1f7d 0%, #120d26 100%)',
    topColor: '#120d26',
    textPrimary: '#f4f1ff',
    cardBg: 'rgba(26,19,56,0.55)',
    vars: {
      bgGradient:
        'radial-gradient(800px 800px at 5% 5%, rgba(124,92,255,0.55) 0%, transparent 70%),' +
        'radial-gradient(700px 700px at 95% 8%, rgba(196,77,219,0.42) 0%, transparent 68%),' +
        'radial-gradient(650px 650px at 50% 50%, rgba(124,92,255,0.18) 0%, transparent 72%),' +
        'radial-gradient(500px 500px at 88% 88%, rgba(255,111,145,0.22) 0%, transparent 65%),' +
        'linear-gradient(160deg, #1d1640 0%, #15102b 45%, #120d26 100%)',
      topColor: '#120d26',
      navBg: 'rgba(20,14,40,0.92)',
      navBorder: 'rgba(255,255,255,0.10)',
      textPrimary: '#f4f1ff',
      accent: '#7c5cff',
      accent2: '#c44ddb',
      accentFrom: '#ff6f91',
      accentTo: '#7c5cff',
      accentText: '#ffffff',
      cardBg: 'rgba(26,19,56,0.55)',
      cardBorder: 'rgba(124,92,255,0.20)',
      cardTint1: 'rgba(124,92,255,0.13)',
      cardTint2: 'rgba(196,77,219,0.08)',
      cardShadow: 'rgba(80,40,140,0.55)',
      cardAccent1: 'rgba(124,92,255,0.30)',
      cardAccent2: 'rgba(196,77,219,0.30)',
    },
  },
  {
    id: 'tideglow',
    label: 'Tideglow',
    emoji: '🌊',
    // Deep ocean — cool cyan/teal glow on a navy-black base.
    bgGradient:
      'radial-gradient(800px 800px at 10% 5%, rgba(0,200,255,0.45) 0%, transparent 70%),' +
      'radial-gradient(700px 700px at 90% 15%, rgba(64,255,210,0.30) 0%, transparent 68%),' +
      'radial-gradient(600px 600px at 50% 90%, rgba(0,120,200,0.30) 0%, transparent 72%),' +
      'linear-gradient(160deg, #051a2c 0%, #04101e 50%, #020912 100%)',
    cardBorder: 'rgba(0,200,255,0.22)',
    accent: '#00c8ff',
    navBorder: 'rgba(0,200,255,0.15)',
    navBg: 'rgba(5,16,30,0.92)',
    swatchGradient: 'linear-gradient(135deg, #023049 0%, #020912 100%)',
    topColor: '#020912',
    textPrimary: '#e3f5ff',
    cardBg: 'rgba(8,28,46,0.62)',
    vars: {
      bgGradient:
        'radial-gradient(800px 800px at 10% 5%, rgba(0,200,255,0.45) 0%, transparent 70%),' +
        'radial-gradient(700px 700px at 90% 15%, rgba(64,255,210,0.30) 0%, transparent 68%),' +
        'radial-gradient(600px 600px at 50% 90%, rgba(0,120,200,0.30) 0%, transparent 72%),' +
        'linear-gradient(160deg, #051a2c 0%, #04101e 50%, #020912 100%)',
      topColor: '#020912',
      navBg: 'rgba(5,16,30,0.92)',
      navBorder: 'rgba(0,200,255,0.15)',
      textPrimary: '#e3f5ff',
      accent: '#00c8ff',
      accent2: '#40ffd2',
      accentFrom: '#40ffd2',
      accentTo: '#00a8ff',
      accentText: '#02141f',
      cardBg: 'rgba(8,28,46,0.62)',
      cardBorder: 'rgba(0,200,255,0.22)',
      cardTint1: 'rgba(0,200,255,0.13)',
      cardTint2: 'rgba(64,255,210,0.07)',
      cardShadow: 'rgba(0,90,140,0.55)',
      cardAccent1: 'rgba(0,200,255,0.30)',
      cardAccent2: 'rgba(64,255,210,0.28)',
    },
  },
  {
    id: 'verdant',
    label: 'Verdant',
    emoji: '🌿',
    // Soft forest — natural greens with a touch of amber warmth.
    bgGradient:
      'radial-gradient(800px 800px at 8% 5%, rgba(45,255,143,0.32) 0%, transparent 70%),' +
      'radial-gradient(700px 700px at 92% 18%, rgba(255,200,80,0.18) 0%, transparent 65%),' +
      'radial-gradient(600px 600px at 50% 95%, rgba(20,150,90,0.28) 0%, transparent 72%),' +
      'linear-gradient(160deg, #082015 0%, #061a11 50%, #04140c 100%)',
    cardBorder: 'rgba(45,255,143,0.20)',
    accent: '#2dff8f',
    navBorder: 'rgba(45,255,143,0.13)',
    navBg: 'rgba(6,20,12,0.93)',
    swatchGradient: 'linear-gradient(135deg, #0e3a26 0%, #04140c 100%)',
    topColor: '#04140c',
    textPrimary: '#e8fff1',
    cardBg: 'rgba(10,28,18,0.62)',
    vars: {
      bgGradient:
        'radial-gradient(800px 800px at 8% 5%, rgba(45,255,143,0.32) 0%, transparent 70%),' +
        'radial-gradient(700px 700px at 92% 18%, rgba(255,200,80,0.18) 0%, transparent 65%),' +
        'radial-gradient(600px 600px at 50% 95%, rgba(20,150,90,0.28) 0%, transparent 72%),' +
        'linear-gradient(160deg, #082015 0%, #061a11 50%, #04140c 100%)',
      topColor: '#04140c',
      navBg: 'rgba(6,20,12,0.93)',
      navBorder: 'rgba(45,255,143,0.13)',
      textPrimary: '#e8fff1',
      accent: '#2dff8f',
      accent2: '#ffc850',
      accentFrom: '#a8ff5d',
      accentTo: '#10c073',
      accentText: '#04140c',
      cardBg: 'rgba(10,28,18,0.62)',
      cardBorder: 'rgba(45,255,143,0.20)',
      cardTint1: 'rgba(45,255,143,0.12)',
      cardTint2: 'rgba(255,200,80,0.07)',
      cardShadow: 'rgba(10,80,40,0.55)',
      cardAccent1: 'rgba(45,255,143,0.28)',
      cardAccent2: 'rgba(255,200,80,0.26)',
    },
  },
  {
    id: 'emberlight',
    label: 'Emberlight',
    emoji: '🔥',
    // Warm sunset — coral and orange embers fading into deep red-black.
    bgGradient:
      'radial-gradient(800px 800px at 8% 5%, rgba(255,122,64,0.45) 0%, transparent 70%),' +
      'radial-gradient(700px 700px at 92% 18%, rgba(255,80,120,0.32) 0%, transparent 65%),' +
      'radial-gradient(650px 650px at 50% 90%, rgba(200,40,40,0.22) 0%, transparent 70%),' +
      'linear-gradient(160deg, #2a0e07 0%, #1c0805 50%, #100403 100%)',
    cardBorder: 'rgba(255,122,64,0.24)',
    accent: '#ff7a40',
    navBorder: 'rgba(255,122,64,0.16)',
    navBg: 'rgba(28,8,5,0.93)',
    swatchGradient: 'linear-gradient(135deg, #4a1a0e 0%, #100403 100%)',
    topColor: '#100403',
    textPrimary: '#fff0e8',
    cardBg: 'rgba(36,12,8,0.62)',
    vars: {
      bgGradient:
        'radial-gradient(800px 800px at 8% 5%, rgba(255,122,64,0.45) 0%, transparent 70%),' +
        'radial-gradient(700px 700px at 92% 18%, rgba(255,80,120,0.32) 0%, transparent 65%),' +
        'radial-gradient(650px 650px at 50% 90%, rgba(200,40,40,0.22) 0%, transparent 70%),' +
        'linear-gradient(160deg, #2a0e07 0%, #1c0805 50%, #100403 100%)',
      topColor: '#100403',
      navBg: 'rgba(28,8,5,0.93)',
      navBorder: 'rgba(255,122,64,0.16)',
      textPrimary: '#fff0e8',
      accent: '#ff7a40',
      accent2: '#ff5080',
      accentFrom: '#ffb547',
      accentTo: '#ff4d6d',
      accentText: '#1c0805',
      cardBg: 'rgba(36,12,8,0.62)',
      cardBorder: 'rgba(255,122,64,0.24)',
      cardTint1: 'rgba(255,122,64,0.14)',
      cardTint2: 'rgba(255,80,120,0.08)',
      cardShadow: 'rgba(140,40,20,0.55)',
      cardAccent1: 'rgba(255,122,64,0.30)',
      cardAccent2: 'rgba(255,80,120,0.30)',
    },
  },
  {
    id: 'nightcourt',
    label: 'Nightcourt',
    emoji: '🏸',
    // Stadium floodlights — graphite black court lit by volt green with hot
    // orange court-line accents. Athletic, high-contrast, zero pastel.
    bgGradient:
      'radial-gradient(900px 700px at 12% -5%, rgba(204,255,0,0.30) 0%, transparent 65%),' +
      'radial-gradient(700px 600px at 95% 12%, rgba(255,94,31,0.16) 0%, transparent 62%),' +
      'radial-gradient(700px 700px at 50% 108%, rgba(140,200,20,0.14) 0%, transparent 70%),' +
      'linear-gradient(165deg, #12160a 0%, #0b0e07 45%, #060804 100%)',
    cardBorder: 'rgba(204,255,0,0.22)',
    accent: '#ccff00',
    navBorder: 'rgba(204,255,0,0.15)',
    navBg: 'rgba(10,13,6,0.93)',
    swatchGradient: 'linear-gradient(135deg, #2c3a0a 0%, #060804 100%)',
    topColor: '#060804',
    textPrimary: '#f4ffe0',
    cardBg: 'rgba(16,20,10,0.62)',
    vars: {
      bgGradient:
        'radial-gradient(900px 700px at 12% -5%, rgba(204,255,0,0.30) 0%, transparent 65%),' +
        'radial-gradient(700px 600px at 95% 12%, rgba(255,94,31,0.16) 0%, transparent 62%),' +
        'radial-gradient(700px 700px at 50% 108%, rgba(140,200,20,0.14) 0%, transparent 70%),' +
        'linear-gradient(165deg, #12160a 0%, #0b0e07 45%, #060804 100%)',
      topColor: '#060804',
      navBg: 'rgba(10,13,6,0.93)',
      navBorder: 'rgba(204,255,0,0.15)',
      textPrimary: '#f4ffe0',
      accent: '#ccff00',
      accent2: '#ff5e1f',
      accentFrom: '#eaff4d',
      accentTo: '#8fd400',
      accentText: '#0b0e07',
      cardBg: 'rgba(16,20,10,0.62)',
      cardBorder: 'rgba(204,255,0,0.22)',
      cardTint1: 'rgba(204,255,0,0.10)',
      cardTint2: 'rgba(255,94,31,0.07)',
      cardShadow: 'rgba(90,120,10,0.50)',
      cardAccent1: 'rgba(204,255,0,0.30)',
      cardAccent2: 'rgba(255,94,31,0.30)',
    },
  },
];

export function getSavedTheme(): ThemeId {
  // Bump CURRENT_VERSION any time you want to force all users back to the default.
  // v3 → cleaned-up 4-theme set (Aurora, Tideglow, Verdant, Emberlight).
  // NOTE: version intentionally NOT bumped when Nightcourt became the default —
  // new users get Nightcourt, but anyone who already picked a theme keeps it.
  const CURRENT_VERSION = '3';
  const DEFAULT_THEME: ThemeId = 'nightcourt';
  if (localStorage.getItem('bb-theme-version') !== CURRENT_VERSION) {
    localStorage.setItem('bb-theme-version', CURRENT_VERSION);
    localStorage.setItem('bb-theme', DEFAULT_THEME);
    return DEFAULT_THEME;
  }
  const stored = localStorage.getItem('bb-theme') as ThemeId | null;
  return stored && THEMES.find(t => t.id === stored) ? stored : DEFAULT_THEME;
}

export function applyTheme(id: ThemeId) {
  // Fall back to the default theme (Nightcourt) rather than THEMES[0] so an
  // unknown/stale id lands on the same theme new users see.
  const theme = THEMES.find(t => t.id === id)
    ?? THEMES.find(t => t.id === 'nightcourt')
    ?? THEMES[0];
  const root = document.documentElement;
  const v = theme.vars;

  // Full set of theme vars — read by index.css for cards, buttons, accents.
  root.style.setProperty('--bg-gradient', v.bgGradient);
  root.style.setProperty('--top-color', v.topColor);
  root.style.setProperty('--nav-bg', v.navBg);
  root.style.setProperty('--nav-border', v.navBorder);
  root.style.setProperty('--text-primary', v.textPrimary);
  root.style.setProperty('--accent', v.accent);
  root.style.setProperty('--accent-2', v.accent2);
  root.style.setProperty('--accent-from', v.accentFrom);
  root.style.setProperty('--accent-to', v.accentTo);
  root.style.setProperty('--accent-text', v.accentText);
  root.style.setProperty('--card-bg', v.cardBg);
  root.style.setProperty('--card-border', v.cardBorder);
  root.style.setProperty('--card-tint-1', v.cardTint1);
  root.style.setProperty('--card-tint-2', v.cardTint2);
  root.style.setProperty('--card-shadow', v.cardShadow);
  root.style.setProperty('--card-accent-1', v.cardAccent1);
  root.style.setProperty('--card-accent-2', v.cardAccent2);

  localStorage.setItem('bb-theme', id);

  // iOS status bar
  root.style.background = v.topColor;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', v.topColor);

  // body theme class for any theme-specific overrides
  const knownClasses = THEMES.map(t => `theme-${t.id}`);
  document.body.classList.remove(...knownClasses);
  document.body.classList.add(`theme-${id}`);
}

export const QUOTES = [
  'Champions train, losers complain!',
  'Every session makes you better!',
  'Smash it like you mean it!',
  'Show up. Play hard. Repeat.',
  'The court is calling!',
  "Good players practice until they get it right. Great players can't get it wrong.",
  'Sweat now, shine later!',
  'One more rally, one more win!',
  'Badminton is life!',
  'Play like a champion today!',
];
