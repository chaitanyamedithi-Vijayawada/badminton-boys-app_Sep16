# Badminton Boys — Audit Fixes

Status after this pass: **0 TypeScript errors, 0 ESLint errors** (was 17 + 26),
production build passes.

---

## 1. Email bugs (functional)

### Session-complete email showed "Invalid Date / undefined / undefined hrs"
The live path (`AppContext.completeSession` → `sendSessionEmail`) wasn't sending
`week`, `sessionTime`, or `hoursPlayed`, but the email template renders all three.

- `src/lib/notifications.ts` — added `week`, `sessionTime`, `hoursPlayed` to
  `sendSessionEmail` params and request body.
- `src/context/AppContext.tsx` — both callers (`completeSession` and
  `completeExtraSession`) now pass them. Tuesday time comes from the `tue_time`
  setting; Saturday uses the default; extra sessions use their start/end time.

### Monthly email showed wrong balances
`monthly-email` read current balance from the legacy `wallets` table, but the live
app computes balances from the `transactions` ledger.

- `supabase/functions/monthly-email/index.ts` — `currentBalance` is now
  `sum(prior-month tx) + sum(this-month tx)` from `transactions`. Removed the
  dead duplicate top-up computation block.

---

## 2. Type & lint cleanup

- `src/components/Header.tsx` — removed duplicate `background` style property.
- `src/context/AppContext.tsx` — removed phantom `s.hours` (uses `courts_count * 2`);
  dropped unused `useMemo` import; typed transaction/court-payment reducers;
  added `settings`/`players` to the relevant `useCallback` deps.
- `src/tabs/AdminTab.tsx` — handler `id` params changed `string` → `number`
  (matches `Payment.id` / `PlayerTransfer.id`).
- `src/tabs/HistoryTab.tsx` — `brought_by` made optional in the local guest types
  to match `GuestEntry` (no runtime change).
- `src/tabs/HomeTab.tsx` — removed dead `transferAmount` state; fixed a guarded
  `string | undefined` arg.
- `src/components/match/RoundCard.tsx` — removed unused `allPlayingPlayers`
  destructure and dead locals.
- `src/tabs/MatchTab.tsx`, `src/tabs/PlayersTab.tsx` — removed unused destructures.
- `src/main.tsx` — `componentDidCatch(error: unknown)` instead of `any`.
- `src/components/match/DownloadPDF.tsx` — scoped, documented `no-explicit-any`
  exception (jsPDF interop over dynamically-shaped data with runtime guards).
- `eslint.config.js` — added conventional `no-unused-vars` ignore patterns
  (`^_` args/vars, `caughtErrors: 'none'`).
- Removed `index copy.html` (unreferenced 129 KB duplicate).

### Remaining lint: 18 warnings, 0 errors
All are `react-hooks/exhaustive-deps` hints. Left untouched on purpose — changing
hook deps blindly can alter render/effect behavior. Worth a careful manual pass.

---

## 3. Security  ⚠️ ACTION REQUIRED BEFORE NEXT DEPLOY

### OneSignal REST key was hardcoded in source
- `supabase/functions/send-notification/index.ts` — now reads
  `Deno.env.get("ONESIGNAL_REST_API_KEY")` and returns a clear error if unset.
- **You must set the secret or push notifications will stop:**
  ```
  supabase secrets set ONESIGNAL_REST_API_KEY=kaisgflvdudseai4cagwmgomq
  ```
  Then redeploy: `supabase functions deploy send-notification`.
  **Also rotate this key in the OneSignal dashboard** — it was committed to source,
  so treat it as compromised.

### Admin PIN was hardcoded in the client bundle
- `src/lib/constants.ts` — now reads `import.meta.env.VITE_ADMIN_PIN`.
- `.env` — added `VITE_ADMIN_PIN=1957`; `.env.example` documents all keys.
- **Honest limitation:** Vite `VITE_*` vars are still bundled into the browser JS,
  so the PIN is out of source control but *not* truly secret. Real protection needs
  server-side auth (see below).

### Not changed (need your decision — architectural)
- **No real auth.** The app uses the public anon key; RLS only blocks malformed
  rows, not unauthorized ones. Anyone can write to `transactions`, `settings`,
  `players` from the browser console. For a private friend group the practical risk
  is low, but financial writes are not server-protected. A proper fix is Supabase
  Auth + RLS keyed on `auth.uid()`, which is a larger change.
- **PIN hashing** is unsalted SHA-256; a 4-digit PIN is brute-forceable regardless,
  so salting buys little. Left as-is.

---

## 4. Performance (assessment)

- jsPDF (390 KB) + html2canvas (201 KB) are **already lazy-loaded**
  (`await import('jspdf')` fires only on export) — they do **not** affect initial load. Good.
- Initial load is the ~496 KB main chunk (135 KB gzip) + 50 KB CSS — acceptable.
  If you want it leaner later, lazy-load tabs with `React.lazy`.
- Balances are computed by pulling all `transactions` and summing client-side; fine
  now, grows linearly. A DB view/RPC would scale better long-term.
- Build warning: `supabase.ts` is both statically and dynamically imported
  (via `Header.tsx`). Harmless; cosmetic.

---

## 5. Not deleted (your call)
- The `complete-session` edge function and the `wallets` table are orphaned (the live
  app uses the `transactions` ledger). Recommend removing them once you've confirmed
  nothing else depends on them — but I left them in place rather than delete a whole
  subsystem without sign-off.
- `theme-preview.html` (45 KB) is unreferenced but looks like a deliberate design
  reference, so I kept it.

---

## Round 2 — cleanup of unused pieces

- **Deleted** `supabase/functions/complete-session/` — orphaned edge function, not
  called from anywhere. Verified: 0 type errors, 0 lint errors, build passes after removal.
- **Added** `supabase/migrations/20260603000000_drop_orphaned_wallets_table.sql` —
  drops the now-unused `wallets` table. ⚠️ DESTRUCTIVE: it permanently deletes the
  table when applied. Export a backup first if you want one, or delete this migration
  file if you're not ready. (The app no longer reads or writes `wallets`.)

### One thing to decide — possible scheduler logic gap (NOT changed)
In `src/lib/matchScheduler.ts`, `selectResting` is headed "Strict sit-out priority:
Guests first…", but the implementation treats guests/unranked the same as
Intermediate players (tier 2), so guests are **not** actually rested first. The
`guestSet` parameter is unused (prefixed `_guestSet`). Either the comment is stale
or guest-first resting was never finished. I left the behavior as-is because it
changes who plays vs. sits in every session — tell me which you want:
(a) guests sit out first, or (b) keep treating guests as mid-tier (and I'll fix the comment).

### Honest note on "no more bugs"
The app now compiles cleanly, lints with 0 errors, and builds. That rules out a
whole class of errors, but it is not the same as bug-free — logic/runtime bugs can
only be confirmed by testing with real data. One residual edge case worth knowing:
if two devices auto-finalize the exact same session at the same instant, the
per-session guard could be bypassed and charges inserted twice. It's unlikely given
the in-flight lock, but a DB-level unique constraint on the charge rows would make
it bulletproof if you ever see it happen.

---

## Round 3 — scheduler sit-out priority (implemented)

Decision: guests rest first, then by skill. Implemented in `src/lib/matchScheduler.ts`
`selectResting`: sit-out order is now **Guest → Beginner → Intermediate → Expert**
(experts rest last). Guests are identified by `guestSet` membership, so a guest sits
out before any regular regardless of the guest's own skill. Applies to the free-mix
rounds where guests play; skill-phase rounds already exclude guests. Verified with a
simulation across needToRest = 1–4. Also fixed the stale comment and a stray `;;`.

---

## Round 4 — Android bottom nav clipping

The bottom nav icons/labels were getting cut off behind the Android system
navigation bar (gesture pill / 3-button bar).

Cause: `.bottom-nav` had no bottom safe-area inset, so its lower edge rendered
behind the system bar. Separately, the content area's safe-area-aware padding rule
was being overridden by a Tailwind `pb-20` utility.

Fix (`src/index.css`, `src/App.tsx`):
- `.bottom-nav` now has `padding-bottom: env(safe-area-inset-bottom, 0px)` so the
  icons/labels sit above the system bar (the nav background fills the inset area).
- `.app-content` padding-bottom is now `calc(nav height + safe-area inset + 24px)`,
  and the conflicting `pb-20` was removed from `App.tsx` so this rule applies.

Falls back to `0px` where there's no inset (desktop, hardware-button phones), so no
regression there. `viewport-fit=cover` and `display: standalone` were already set,
which is what makes the inset resolve correctly on installed Android PWAs.
