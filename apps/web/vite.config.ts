/**
 * @author Codex
 * @description Configures the Pi Web Vite build, React compiler, Tailwind, and local API proxies.
 */
import { fileURLToPath } from 'node:url';
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
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'SERVER_');
  const host = env.SERVER_HOST?.trim() || '127.0.0.1';
  const proxyHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host;
  const port = env.SERVER_PORT?.trim() || '3000';
  const target = `http://${proxyHost}:${port}`;
  return {
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
