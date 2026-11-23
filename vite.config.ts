import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Explicit asset list — NOT ['**/*']. The greedy glob was scooping up
      // Netlify's `_headers` file into the precache manifest; that file 404s
      // when the service worker fetches it, which failed precaching and blocked
      // the new SW from installing (so update banners never fired and users had
      // to hard-refresh). Listing real assets only avoids that.
      includeAssets: [
        'icon-48.png', 'icon-72.png', 'icon-96.png', 'icon-144.png',
        'icon-192.png', 'icon-512.png', 'icon-192-maskable.png', 'icon-512-maskable.png',
        'apple-touch-icon.png',
        'apple-touch-icon-57x57.png', 'apple-touch-icon-60x60.png',
        'apple-touch-icon-72x72.png', 'apple-touch-icon-76x76.png',
        'apple-touch-icon-114x114.png', 'apple-touch-icon-120x120.png',
        'apple-touch-icon-144x144.png', 'apple-touch-icon-152x152.png',
        'apple-touch-icon-167x167.png', 'apple-touch-icon-180x180.png',
        'badminton-logo.png',
        'fonts/**/*',
      ],
      workbox: {
        // Core background updating controls. autoUpdate + skipWaiting keeps
        // clients current automatically: a new version is applied when the app
        // is (re)opened, with no "Update now" popup. The aggressive per-60s /
        // on-focus update polling was removed from main.tsx, so this no longer
        // causes constant mid-session refreshing on desktop.
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf,jpg,mp4,webm}'],
        // splash video must be cached so it plays instantly offline
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // full-size brand masters are for stores/printing, not the app
        globIgnores: ['**/brand/courtcrew-*'],
        
        // Static Asset cache policies
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/.*\.woff2$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          // Exercise GIFs (Supabase storage, public "warmups" bucket). Saved on
          // the phone the first time they're seen, then served from the device
          // — instant and works offline at the court. 40 entries × ~350 KB caps
          // this at ~14 MB; purgeOnQuotaError drops it first if storage is low.
          {
            urlPattern: /\/storage\/v1\/object\/public\/warmups\/.+\.gif$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'warmup-gifs',
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
                purgeOnQuotaError: true,
              },
            },
          },
          // Exercise list: show the saved copy instantly (and offline), refresh
          // it in the background when online.
          {
            urlPattern: /\/rest\/v1\/warmup_exercises\b/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'warmup-list',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 5, purgeOnQuotaError: true },
            },
          },
        ],
      },
      manifest: {
        name: 'CourtCrew',
        short_name: 'CourtCrew',
        description: 'Court sessions, RSVPs and shared costs for your sports group',
        start_url: '/',
        display: 'standalone',
        background_color: '#151f21',
        theme_color: '#22d3ee',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});