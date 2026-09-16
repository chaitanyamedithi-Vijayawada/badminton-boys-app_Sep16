import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { initMonitoring } from './lib/monitoring';

// Start error monitoring as early as possible (no-op unless VITE_SENTRY_DSN set).
initMonitoring();

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: unknown) {
    console.error("App bundle crash caught:", error);
    // Forward to Sentry if it's initialized; dynamic import keeps this a no-op
    // when monitoring is disabled and avoids a hard dependency at module load.
    import('./lib/monitoring').then(({ reportError }) => reportError(error));
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 p-6 text-center">
          <p className="text-cyan-400 text-sm font-semibold mb-2">⚡ App Update Detected</p>
          <p className="text-slate-400 text-xs mb-4">A new version of Badminton Boys was just published.</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-cyan-500 text-black font-semibold rounded-xl text-xs hover:bg-cyan-400">
            Refresh Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── PWA update handling ──────────────────────────────────────────────────────
// Checks for a new deployed version every 60s while the app is open, and
// whenever the app regains focus (e.g. user switches back from another app).
// This closes the gap where a stale PWA install silently keeps running old
// code — the exact issue that caused premature session finalization bugs.
let updateSW: (() => Promise<void>) | undefined;

function showUpdateBanner() {
  if (document.getElementById('pwa-update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-update-banner';
  banner.style.cssText = `
    position: fixed; bottom: 16px; left: 16px; right: 16px; z-index: 99999;
    background: linear-gradient(135deg, #ff6f91, var(--accent));
    color: white; padding: 12px 16px; border-radius: 14px;
    font-family: system-ui, sans-serif; font-size: 13px; font-weight: 600;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  `;
  banner.innerHTML = `
    <span>⚡ New version available</span>
    <button id="pwa-update-btn" style="background: white; color: var(--accent); border: none; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 12px;">Update now</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('pwa-update-btn')?.addEventListener('click', () => {
    updateSW?.();
  });
}

if ('serviceWorker' in navigator) {
  updateSW = registerSW({
    onNeedRefresh() {
      showUpdateBanner();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Poll for updates every 60s while the tab is open
      setInterval(() => { registration.update(); }, 60 * 1000);
      // Also check immediately whenever the app regains focus/visibility
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
    },
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);