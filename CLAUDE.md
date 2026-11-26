# CourtCrew (Badminton Boys club app)

A PWA that runs a ~28-player badminton club in Langley/Surrey, BC: weekly
RSVPs, waitlists, match scheduling, a shared wallet for court costs, admin
finance tools, push notifications and a tournament winners board.

- **App name:** CourtCrew. **Club name:** Badminton Boys (still used in emails,
  PDFs and session names).
- **Live:** https://badmintonboys.net
- **Owner / developer:** Chaitanya. Club admins: Eswar, Arun (and Chaitanya).

## Stack

- React 18 + TypeScript + Vite + Tailwind, installable PWA (vite-plugin-pwa).
- Supabase (Postgres + Edge Functions on Deno). Project ref: `xiewyjefyuwumnznbftr`.
- OneSignal web push (app id `d4b596d7-2437-46e4-b883-cf06b43bc590`).
- Resend for email, Sentry for errors.
- Hosting: **Netlify serves badmintonboys.net today** (DNS is at Netlify).
  Vercel project `badmintonboys` also builds every branch; branch builds are the
  test links. The domain has not been moved to Vercel yet.

## Commands

```bash
cp .env.example .env   # then paste the anon key from Supabase → Project Settings → API
npm install
npm run dev        # local dev
npm run typecheck  # 3 pre-existing errors are expected; don't add new ones
npm run build
npm test           # vitest, 38 tests, all must pass
```

## Layout

- `src/tabs/` one file per bottom-nav tab (Home, Players, Fees, History,
  Admin, Cup = TournamentTab, Stretch = ExercisesTab, Match).
- `src/context/AppContext.tsx` shared state, data loading, login.
- `src/lib/` pure logic: `sessionMath`, `waitlist`, `matchScheduler`,
  `tournament`, `cutoff`, `notifications`, `passkeys`, `avatar`.
- `supabase/functions/` all 14 deployed edge functions (synced Nov 2026).
  `supabase/config.toml` records each one's `verify_jwt` setting; keep it in
  step when deploying. Deploy with
  `supabase functions deploy <name> --project-ref xiewyjefyuwumnznbftr`.
  `copy-warmups` is retired (returns 410). Cron jobs call `session-reminders`,
  `waitlist-notify`, `finalize-extra-sessions` and `finalize-regular-sessions`.
- `supabase/migrations/` recent migrations (older schema was made by hand).

## How we work

- Inspect first, plan, then change. Ask Chaitanya before anything that touches
  money, deletes data, or messages the whole club.
- Feature work goes on a `feature/*` branch, gets checked on its Vercel preview
  link, and is merged to `main` only after Chaitanya approves. Small layout
  fixes can go straight to `main`.
- Pushing `main` deploys to production automatically.
- Commit messages: conventional style (`feat(scope): ...`, `fix: ...`).

## Things to be careful with

- **Money.** Balances are the sum of the `transactions` table per player.
  Types: `top_up`, `match_charge`, `misc_charge`, `adjustment`. Fix data with a
  new correcting row, not by editing old ones, unless removing a true duplicate.
  Court hours remaining = sum of `court_payments.hours_purchased` minus
  `completed_sessions.courts_count * session_hours`.
- **Extra-session charges have no `session_id`**; they're matched by note:
  `Extra Session — <title> · <date>`.
- **Confirm/reject of payments and transfers** must only act on rows still
  `pending` (prevents double credit).
- **Notification links** must point to `https://badmintonboys.net`, never a
  `*.netlify.app` / `*.vercel.app` address (send-notification rewrites them).
  Combining several `player_name` tag filters with OR in one push did not
  deliver; send one push per player, or use the `is_admin` tag for admins.
- **Face ID login = passkeys** (`passkey-auth` function, `player_passkeys`
  table, server-only). The relying party is `badmintonboys.net`; changing the
  domain would orphan everyone's passkeys.
- **Security is weak today:** login only sets a flag in localStorage, and the
  anon key can read/write most tables (including `transactions`). Don't make it
  worse; a real fix (Supabase Auth + per-player RLS) is planned.

## Open to-dos

- Move badmintonboys.net DNS to Vercel (flip redirect so `www` → apex).
- Real authentication + row-level security before any App Store release.
- Capacitor wrapper for iOS/Android, with native OneSignal push.
- About half the players have no working push subscription (installed from the
  old netlify.app address); they need to reinstall from badmintonboys.net.
- `.github/workflows/main.yml` deploys an unused GitHub Pages copy and fails
  intermittently; candidate for removal.
- The live tournament screen in the Cup tab is hidden behind
  `SHOW_LIVE_TOURNAMENT` in `TournamentTab.tsx`.
