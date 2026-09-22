/**
 * @author Codex
 * @description Retries only transient Windows file-sharing failures at atomic metadata IO boundaries.
 */
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Bounds filesystem contention independently of business observation; permissions and corruption still surface.
 */
export async function retryFileContention<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(code ?? '') || attempt >= 4) {
        throw error;
      }
      await delay(10 * 2 ** attempt);
    }
  }
}
