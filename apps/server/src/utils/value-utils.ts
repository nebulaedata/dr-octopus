/**
 * @author Codex
 * @description Provides business-independent type guards, error descriptions, and origin checks.
 */

/**
 * Narrows unknown values to non-array object records.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Detects a Node-style error carrying the requested code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && String(error['code']) === code;
}

/**
 * Narrows the expected exclusive-create collision without exposing raw filesystem failures.
 */
export function isFileExistsError(error: unknown): boolean {
  return hasErrorCode(error, 'EEXIST');
}

/**
 * Converts an unknown failure into diagnostic text for internal logging and events.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Allows browser transports served from the local machine while rejecting remote web origins.
 */
export function isAllowedLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}
