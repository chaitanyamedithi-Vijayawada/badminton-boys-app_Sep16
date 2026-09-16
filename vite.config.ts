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
        // Core background updating controls
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}'],
        
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
        ],
      },
      manifest: {
        name: 'Badminton Boys',
        short_name: 'Badminton Boys',
        description: 'Badminton Boys session management app',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
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