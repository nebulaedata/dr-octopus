/**
 * @author Codex
 * @description Wraps pino-roll inside its worker and publishes the exact active file for safe retention.
 */

import { chmodSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import type { Writable } from 'node:stream';

interface RollingDestination extends Writable {
  file: string | null;
}

interface FileLogWorkerOptions {
  file: string;
  activeMarkerPath: string;
  [key: string]: unknown;
}

type PinoRollFactory = (options: Record<string, unknown>) => Promise<RollingDestination>;

const require = createRequire(import.meta.url);
const createRollingDestination = require('pino-roll') as PinoRollFactory;

/**
 * Creates the rolling destination and keeps a private marker synchronized after every reopen.
 *
 * @param options Rolling policy plus the Server-owned active-file marker path.
 * @returns The worker destination consumed by Pino.
 */
export default async function createFileLogWorker(
  options: FileLogWorkerOptions
): Promise<RollingDestination> {
  const { activeMarkerPath, ...rollOptions } = options;
  const destination = await createRollingDestination(rollOptions);
  const publishActiveFile = () => {
    if (destination.file === null) {
      return;
    }
    writeFileSync(activeMarkerPath, basename(destination.file), {
      encoding: 'utf8',
      mode: 0o600,
    });
    if (process.platform !== 'win32') {
      chmodSync(activeMarkerPath, 0o600);
    }
  };
  if (destination.file === null) {
    await once(destination, 'ready');
  }
  publishActiveFile();
  destination.on('ready', publishActiveFile);
  return destination;
}
