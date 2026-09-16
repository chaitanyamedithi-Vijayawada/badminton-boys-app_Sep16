// ── Error monitoring ──────────────────────────────────────────────────────────
// Completely inert unless VITE_SENTRY_DSN is provided at build time. The Sentry
// SDK is loaded via dynamic import ONLY when a DSN exists, so when monitoring is
// off it isn't part of the initial download at all. No PII, no session replay,
// low trace sampling — tuned to stay comfortably inside the free tier.

export const monitoringEnabled = (): boolean => !!import.meta.env.VITE_SENTRY_DSN;

export async function initMonitoring(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? undefined,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications.',
      'Non-Error promise rejection captured',
    ],
  });
}

// Report a caught error, but only when monitoring is active. Safe no-op otherwise.
export async function reportError(error: unknown): Promise<void> {
  if (!monitoringEnabled()) return;
  const Sentry = await import('@sentry/react');
  Sentry.captureException(error);
}
