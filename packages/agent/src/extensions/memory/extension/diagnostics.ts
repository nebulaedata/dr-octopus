/**
 * @author Claude
 * @description Best-effort JSONL diagnostics for memory extension failures, kept outside the SQLite store.
 */
import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Rotate before the log grows without bound; one backup generation is enough for diagnostics.
 */
const MAX_BYTES = 256 * 1024;
/**
 * Extract a stable public diagnostic; the innermost cause holds the specific original code
 * (for example SQLITE_CANTOPEN) while the outer MemoryError only says STORE_UNAVAILABLE.
 */
function describe(error: unknown): { code?: string; message: string } {
  if (error instanceof Error) {
    let code = (error as { code?: string }).code;
    let cause = (error as Error & { cause?: unknown }).cause;
    while (cause instanceof Error) {
      code = (cause as { code?: string }).code ?? code;
      cause = (cause as Error & { cause?: unknown }).cause;
    }
    return { code, message: error.message };
  }
  return { message: String(error) };
}
/**
 * Create a fire-and-forget logger appending one JSON line per event next to the store.
 *
 * The log file lives in the memory directory but uses plain append-only filesystem
 * writes, so it keeps working exactly when the SQLite store is what failed.
 */
export function createMemoryDiagnostics(directory: string) {
  const file = join(directory, 'extension.log');
  /**
   * Record one diagnostic event, swallowing every filesystem failure.
   */
  return function log(event: string, error?: unknown): void {
    try {
      try {
        if (statSync(file).size > MAX_BYTES) {
          renameSync(file, file + '.bak');
        }
      } catch {
        // A missing file is the common case; rotation applies only once it exists.
      }
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...(error === undefined ? {} : describe(error)),
      });
      appendFileSync(file, line + '\n', 'utf8');
    } catch {
      // Diagnostics must never break the Agent.
    }
  };
}
