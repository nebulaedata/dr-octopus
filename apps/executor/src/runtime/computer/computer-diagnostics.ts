/**
 * @author Codex
 * @description Records finite desktop failure metadata without input text, UI content, endpoints or raw exception messages.
 */
import type { ComputerName } from './computer-inputs';

type ComputerFailure = {
  stage: 'startup' | 'preflight' | 'dispatch' | 'cleanup';
  tool?: ComputerName;
  code: string;
  durationMs: number;
  cleanupConfirmed?: boolean;
};

/**
 * Emits one owning-stage diagnostic; failures remain failures even if a diagnostic sink is unavailable.
 */
export function reportComputerFailure({
  stage,
  tool,
  code,
  durationMs,
  cleanupConfirmed,
}: ComputerFailure): void {
  try {
    console.warn('[executor] Computer failure', {
      stage,
      tool,
      code,
      durationMs: Math.max(0, durationMs),
      cleanupConfirmed,
    });
  } catch {
    // A broken diagnostic sink must not change cleanup or the original execution error.
  }
}
