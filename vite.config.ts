import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['offline.html', 'icons/*.png', 'icons/*.svg', 'favicon.svg'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Only Latin font subsets are stored offline; others load on demand.
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
      },
      manifest: {
        id: '/',
        name: 'Drop Studios',
        short_name: 'Drop Studios',
        description: 'Book dance and fitness classes at Drop Studios, Dublin.',
        lang: 'en-IE',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B1020',
        theme_color: '#1F43E6',
        categories: ['fitness', 'lifestyle', 'sports'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Timetable', url: '/timetable', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'My Membership', url: '/account', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
});
