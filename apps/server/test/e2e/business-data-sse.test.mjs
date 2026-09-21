/**
 * @author Codex
 * @description Runs the real React app through Playwright against an isolated HTTP/SSE and Scheduler fixture.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFixture } from './data-events-fixture.mjs';

test(
  'browser observes cross-page business changes and reconnects without periodic HTTP polling',
  { timeout: 180_000 },
  async () => {
    const fixture = await createFixture();
    try {
      const requireWeb = createRequire(new URL('../../../web/package.json', import.meta.url));
      const { createServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
      const vite = await createServer({
        root: fileURLToPath(new URL('../../../web/', import.meta.url)),
        server: {
          host: '127.0.0.1',
          port: 0,
          proxy: {
            '/api': fixture.url,
            '/e2e': fixture.url,
            '/ws': { target: fixture.url.replace('http:', 'ws:'), ws: true },
          },
        },
      });
      try {
        await vite.listen();
        const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
        const output = await promisify(execFile)(
          process.env.PLAYWRIGHT_PYTHON ?? 'python',
          [fileURLToPath(new URL('./business-data-sse.py', import.meta.url)), url],
          { timeout: 150_000, encoding: 'utf8', maxBuffer: 1024 * 1024 }
        );
        assert.match(output.stdout, /SSE_BROWSER_OK/);
        console.log(output.stdout.trim());
      } finally {
        await vite.close();
      }
    } finally {
      await fixture.close();
    }
  }
);
