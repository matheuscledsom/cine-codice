import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export const PWA_IMAGE_CACHE_BUDGET_MB = 80;
export const PWA_IMAGE_CACHE_MAX_ENTRIES = 320;
export const APP_BUILD_VERSION = '2.7.0';

function resolveGitCommitShort() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
  } catch {
    return 'dev';
  }
}

export function buildVersionManifestInfo() {
  return {
    version: APP_BUILD_VERSION,
    buildTime: new Date().toISOString(),
    commit: resolveGitCommitShort(),
  };
}

function omniprismVersionJsonPlugin(versionInfo) {
  return {
    name: 'omniprism-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(versionInfo, null, 2)}\n`,
      });
    },
  };
}

const buildVersionInfo = buildVersionManifestInfo();

export default defineConfig({
  define: {
    __OMNIPRISM_VERSION_INFO__: JSON.stringify(buildVersionInfo),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          if (id.includes('node_modules/dompurify')) {
            return 'vendor-sanitize';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'vendor-supabase';
          }
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    omniprismVersionJsonPlugin(buildVersionInfo),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/version\.json$/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        globIgnores: ['**/version.json'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(image\.tmdb\.org|s4\.anilist\.co|cdn\.myanimelist\.net|static\.tvmaze\.com|m\.media-amazon\.com|commons\.wikimedia\.org)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cine-codice-posters-lru-80mb',
              expiration: {
                maxEntries: PWA_IMAGE_CACHE_MAX_ENTRIES,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
});
