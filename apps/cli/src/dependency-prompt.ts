/**
 * @author Codex
 * @description Obtains interactive consent for missing runtime dependencies while preserving terminal signal handling.
 */
import { createInterface } from 'node:readline/promises';
import { gatewayError } from './gateway/index.js';

/**
 * Uses ordinary line input; Ctrl+C and EOF cancel without enabling raw mode or exiting behind the caller.
 */
export async function confirmDependencyInstall(registry?: string): Promise<boolean> {
  const input = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  input.once('close', cancel);
  try {
    const answer = await input.question(
      `Registry: ${registry ?? 'existing pnpm configuration (or npm default)'}. Use --registry <url> to select a mirror.\nRuntime dependencies are missing. Install now? [y/N] `,
      {
        signal: abort.signal,
      }
    );
    return /^(y|yes)$/i.test(answer.trim());
  } catch (error) {
    if (abort.signal.aborted) {
      throw gatewayError('INSTALL_CANCELLED', 'Dependency installation cancelled.');
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    input.close();
  }
}
