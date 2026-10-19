/**
 * @author Codex
 * @description Builds the isolated executor Renderer without the Web server integration.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { executorProduct } from './src/contracts/product';

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  plugins: [
    {
      name: 'executor-product-title',
      /**
       * Embeds the authoritative product version in the built and development HTML.
       */
      transformIndexHtml(html) {
        return html.replace(
          '<title>Dr.Octopus Executor</title>',
          `<title>${executorProduct.name} v${executorProduct.version}</title>`
        );
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)) } },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
        computerUse: fileURLToPath(new URL('./src/renderer/computer-use-overlay.html', import.meta.url)),
      },
    },
  },
});
