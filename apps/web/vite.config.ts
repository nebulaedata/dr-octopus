/**
 * @author Codex
 * @description Configures the Pi Web Vite build, React compiler, Tailwind, and local API proxies.
 */
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import viteFastify from '@fastify/vite/plugin';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
/**
 * Keep development HTTP and WebSocket proxies aligned with the standalone Server's root .env.
 */
export default defineConfig(({ mode }) => {
  const releaseConfig = JSON.parse(
    readFileSync(new URL('../../release.config.json', import.meta.url), 'utf8')
  ) as { manifest: { version: string } };
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'SERVER_');
  const host = env.SERVER_HOST?.trim() || '127.0.0.1';
  let proxyHost = host;
  if (host === '0.0.0.0') {
    proxyHost = '127.0.0.1';
  } else if (host === '::') {
    proxyHost = '[::1]';
  }
  const port = env.SERVER_PORT?.trim() || '3000';
  const target = `http://${proxyHost}:${port}`;
  return {
    define: {
      __OCTOPUS_RELEASE_VERSION__: JSON.stringify(releaseConfig.manifest.version),
    },
    build: {
      rolldownOptions: {
        treeshake: {
          // Feature entrypoints are checked pure re-exports; unused entries must not load sibling pages.
          moduleSideEffects: [{ test: /\/src\/features\/[^/]+\/index\.ts$/, sideEffects: false }],
        },
      },
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    plugins: [
      viteFastify({ spa: true }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
    server: {
      proxy: {
        '/api': target,
        '/mcp/knowledge': target,
        '/ws': { target: target.replace('http:', 'ws:'), ws: true },
      },
    },
  };
});
