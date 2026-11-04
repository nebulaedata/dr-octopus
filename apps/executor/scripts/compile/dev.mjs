/**
 * @author Codex
 * @description Starts the local-only Renderer dev server and one owned Electron process.
 */
import { browserDevelopment } from '../../../../scripts/browser-development.mjs';
import { executorTarget } from '../lib/platform.mjs';
executorTarget();
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProcesses } from './build.mjs';
import { applicationApi } from '../lib/compile/application-api.mjs';
import {
  chooseBuildConflict,
  prepareDevelopmentBuild,
  reuseDevelopmentApp,
} from '../lib/compile/development-build.mjs';
const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const development = browserDevelopment(fileURLToPath(new URL('../../../../', import.meta.url)));
const electron = createRequire(import.meta.url)('electron');
if (typeof electron !== 'string') {
  throw new Error('Electron executable path is unavailable.');
}
let child;
let stopping = false;
/**
 * Stops only this session's Electron child, including a stop received during compilation.
 */
function terminate() {
  stopping = true;
  child?.kill();
}
process.on('message', (message) => {
  if (message?.type === 'shutdown') {
    terminate();
  }
});
process.once('disconnect', terminate);
process.once('SIGINT', terminate);
process.once('SIGTERM', terminate);
let reused = false;
try {
  const response = await fetch(`http://127.0.0.1:${development.rendererPort}/`, {
    signal: AbortSignal.timeout(1000),
  });
  reused = response.headers.get('x-octopus-development') === development.key;
  await response.body?.cancel();
} catch {
  // An absent dev server falls through to the checked build path.
}
let built = false;
if (reused) {
  console.log(
    '[executor-dev] Reusing this workspace instance. Main/protocol changes require stopping that session and restarting.'
  );
  await reuseDevelopmentApp(electron, appRoot);
} else {
  built = await prepareDevelopmentBuild({
    build: () => buildProcesses({ hostName: development.hostName }),
    choose: () => chooseBuildConflict(electron),
    reuse: () => reuseDevelopmentApp(electron, appRoot),
  });
}
if (!built || stopping) {
  process.exitCode = 0;
  if (process.connected) {
    process.disconnect();
  }
} else {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    server: {
      host: '127.0.0.1',
      port: development.rendererPort,
      strictPort: true,
      headers: {
        'X-Octopus-Development': development.key,
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${development.rendererPort}; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'`,
      },
    },
  });
  await server.listen();
  try {
    const inventory = applicationApi.hostBundleSchema.parse(
      JSON.parse(await readFile(new URL('../../dist/host-bundle.json', import.meta.url), 'utf8'))
    );
    const bundleId = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
    console.log(
      `[executor-dev] Protocol ${inventory.protocolVersion}; Host bundle ${bundleId}; Runtime target http://127.0.0.1:${development.runtimePort}/mcp`
    );
    while (!stopping) {
      child = spawn(electron, [appRoot, '--executor-dev'], {
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
    if (process.connected) {
      process.disconnect();
    }
  }
}
