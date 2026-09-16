import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}'],
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/.*\.woff2$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
