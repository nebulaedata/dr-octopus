/**
 * @author Codex
 * @description Bounds PDF preflight in a disposable child so parsing and decryption cannot block the HTTP process.
 */
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PreflightSource } from './types.js';

export interface PdfStructureEvidence {
  valid: boolean;
  pageCount: number;
  hasActiveContent: boolean;
  hasEmbeddedObject: boolean;
}

const INVALID: PdfStructureEvidence = {
  valid: false,
  pageCount: 0,
  hasActiveContent: false,
  hasEmbeddedObject: false,
};

/**
 * Returns invalid evidence on parse failure, timeout, OOM, or malformed child output.
 * Resolves only after child exit; the child receives a source path and no application secrets.
 */
export async function inspectPdfStructure(source: PreflightSource): Promise<PdfStructureEvidence> {
  const development = import.meta.url.endsWith('.ts');
  const entry = fileURLToPath(new URL(development ? './pdf-child.ts' : './pdf-child.js', import.meta.url));
  return new Promise((resolve) => {
    const child = fork(entry, [], {
      env: { NODE_ENV: 'production' },
      execArgv: [
        '--max-old-space-size=512',
        ...(development
          ? ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href]
          : []),
      ],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let result = INVALID;
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.on('message', (message: unknown) => {
      if (isEvidence(message)) {
        result = message;
      }
      child.kill();
    });
    child.once('error', () => {
      result = INVALID;
      child.kill();
    });
    child.once('close', () => {
      clearTimeout(timeout);
      resolve(result);
    });
    child.send(source.path, (error) => {
      if (error !== null) {
        child.kill();
      }
    });
  });
}

/**
 * Checks the complete, small child result contract before exposing admission evidence.
 */
function isEvidence(value: unknown): value is PdfStructureEvidence {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.valid === 'boolean' &&
    typeof candidate.pageCount === 'number' &&
    Number.isSafeInteger(candidate.pageCount) &&
    candidate.pageCount >= 0 &&
    typeof candidate.hasActiveContent === 'boolean' &&
    typeof candidate.hasEmbeddedObject === 'boolean'
  );
}
