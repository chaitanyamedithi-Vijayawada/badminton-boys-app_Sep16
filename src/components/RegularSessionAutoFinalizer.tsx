import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { getCompletedWeekKey } from '../lib/constants';
import { getPacificNow } from '../lib/cutoff';
import type { Day } from '../types';

// Auto-finalizes a regular (Saturday / Wednesday) session 2 hours after it ends,
// so History and charges no longer depend on an admin manually tapping Finalize
// inside a narrow window. Runs in-browser on whoever has the app open; the DB
// (week,day) UNIQUE constraint makes concurrent runs safe (see completeSession).
//
// This only decides WHETHER to attempt — completeSession re-checks the 2h guard,
// the existing-row guard, and the atomic DB lock, so it is the single source of
// truth. If the whole club stays offline past the finalize window, the session
// falls through to the admin "Log past session" tool, exactly as before.

const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // re-check every 5 min while open
const FINALIZE_DELAY_MS = 120 * 60 * 1000;    // 2 hours after session end
const REGULAR_DAYS: Day[] = ['saturday', 'wednesday'];

// Stops the same tab from firing a second finalize for one session while the
// first is still in flight (keyed `${week}-${day}`).
const inFlight = new Set<string>();

export default function RegularSessionAutoFinalizer() {
  const { dataReady, completedSessions, completeSession, settings } = useApp();

  // Hold the latest context values in a ref so the interval effect can stay
  // mounted once (empty deps) without going stale.
  const latest = useRef({ dataReady, completedSessions, completeSession, settings });
  latest.current = { dataReady, completedSessions, completeSession, settings };

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const { dataReady, completedSessions, completeSession, settings } = latest.current;
      // Wait until sessions are loaded — otherwise we can't tell what's already
      // finalized and could attempt a session that's actually done.
      if (!dataReady) return;

      const week = getCompletedWeekKey();
      const now = getPacificNow().getTime();
      const [wy, wm, wd] = week.split('-').map(Number);

      for (const day of REGULAR_DAYS) {
        // Already finalized this week's session for this day → nothing to do.
        if (completedSessions.some(s => s.week === week && s.day === day && !s.is_extra)) continue;

        // Compute this session's end time (mirrors completeSession's guard).
        const end = new Date(wy, wm - 1, wd, 9, 0, 0, 0); // Saturday 9:00 AM
        if (day === 'wednesday') {
          end.setDate(end.getDate() - 3);                 // Wednesday
          end.setHours(Number(settings['wed_end_hour']) || 20, 0, 0, 0);
        }
        if (now < end.getTime() + FINALIZE_DELAY_MS) continue; // not 2h past end yet

        const key = `${week}-${day}`;
        if (inFlight.has(key)) continue;
        inFlight.add(key);
        try {
          await completeSession(day);
        } catch {
          // Non-fatal — the next tick (or another client) retries.
        } finally {
          inFlight.delete(key);
        }
      }
    };

    void tick(); // run once on mount
    const id = setInterval(() => { if (!cancelled) void tick(); }, CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return null;
}