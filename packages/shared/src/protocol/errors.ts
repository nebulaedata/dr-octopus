/**
 * @author Codex
 * @description Defines the generic public API failure envelope shared by Web and Server.
 */

export interface ApiErrorDto {
  code: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
}
