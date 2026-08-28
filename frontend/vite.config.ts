import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * In development the app talks to the FastAPI service through a proxy so the
 * browser sees same-origin requests and SSE is never buffered by CORS
 * preflight. In production `VITE_API_BASE_URL` addresses the service directly.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const backend = env.VITE_DEV_PROXY_TARGET ?? 'http://127.0.0.1:8000';

  return {
    base: env.VITE_BASE_PATH ?? '/',
    plugins: [react()],
    resolve: {
      alias: {
        '@presentation': fileURLToPath(new URL('./src/presentation', import.meta.url)),
        '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
        '@bff': fileURLToPath(new URL('./src/bff', import.meta.url)),
        '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
          // SSE must not be buffered by the dev proxy.
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
                proxyRes.headers['cache-control'] = 'no-cache, no-transform';
              }
            });
          },
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
