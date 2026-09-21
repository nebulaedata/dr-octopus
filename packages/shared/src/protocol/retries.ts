/**
 * @author Codex
 * @description Defines the transport-safe active auto-retry state cached by the Host for reconnect recovery.
 */

export interface ActiveAutoRetryDto {
  phase: 'waiting' | 'retrying';
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
  scheduledAt: string;
}
