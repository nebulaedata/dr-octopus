/**
 * @author Codex
 * @description Starts the local-only Renderer dev server and one owned Electron process.
 */
import { executorTarget } from '../lib/platform.mjs';
executorTarget();
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { buildProcesses } from './build.mjs';
import { applicationApi } from '../lib/compile/application-api.mjs';
import {
  chooseBuildConflict,
  prepareDevelopmentBuild,
  reuseDevelopmentApp,
} from '../lib/compile/development-build.mjs';
const electron = createRequire(import.meta.url)('electron');
if (typeof electron !== 'string') {
  throw new Error('Electron executable path is unavailable.');
}
const built = await prepareDevelopmentBuild({
  build: buildProcesses,
  choose: () => chooseBuildConflict(electron),
  reuse: () => reuseDevelopmentApp(electron, fileURLToPath(new URL('../../', import.meta.url))),
});
if (!built) {
  process.exitCode = 0;
} else {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    server: {
      host: '127.0.0.1',
      port: 5178,
      strictPort: true,
      headers: {
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5178; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'",
      },
    },
  });
  await server.listen();
  let child;
  let stopping = false;
  /**
   * Terminates only the development application's owned Main process.
   * Utility Process parent-death cleanup is verified separately by integration tests.
   */
  function terminate() {
    stopping = true;
    child?.kill();
  }
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);
  try {
    while (!stopping) {
      child = spawn(electron, [fileURLToPath(new URL('../../', import.meta.url)), '--executor-dev'], {
        stdio: 'inherit',
        shell: false,
      });
      const code = await new Promise((resolve, reject) => {
        child.once('exit', (code) => {
          resolve(code ?? 1);
        });
        child.once('error', reject);
      });
      if (stopping || code !== applicationApi.developmentRestartExitCode) {
        process.exitCode = stopping ? 0 : code;
        break;
      }
    }
  } finally {
    process.removeListener('SIGINT', terminate);
    process.removeListener('SIGTERM', terminate);
    await server.close();
  }
}
