// Regular (Saturday / Wednesday) session finalization now runs SERVER-SIDE via
// the `finalize-regular-sessions` edge function (pg_cron, every 2 min). It
// finalizes the moment the session has ended in Pacific time — no buffer — and
// immediately triggers the summary emails, so it no longer depends on a member
// having the app open. This in-browser auto-finalizer is therefore intentionally
// disabled (kept as a mounted no-op so App.tsx wiring is unchanged). The admin
// "Log past session" tool remains for any manual edge case.
export default function RegularSessionAutoFinalizer() {
  return null;
}
