/**
 * @author Codex
 * @description Projects serialized Server events onto a bounded persistent-log schema before disk writes.
 */

const SAFE_SCALAR_FIELDS = new Set([
  'attachmentId',
  'attempt',
  'code',
  'durationMs',
  'errorCode',
  'event',
  'extension',
  'host',
  'jobId',
  'level',
  'msg',
  'networkUnavailable',
  'phase',
  'pid',
  'port',
  'reason',
  'removed',
  'requestId',
  'reqId',
  'responseTime',
  'result',
  'retryable',
  'runtimeId',
  'schemaVersion',
  'service',
  'sessionId',
  'sha256',
  'statusCode',
  'time',
  'usedRatio',
  'workspaceId',
]);

const SAFE_ARRAY_FIELDS = new Set(['extensions']);
const MAX_STRING_LENGTH = 1024;
const REDACTED_VALUE = '[Redacted]';

/**
 * Parses one Pino line and returns a JSONL line containing only approved diagnostic metadata.
 *
 * @param message Serialized Pino event emitted by the shared root logger.
 * @returns A persistent-safe JSONL record, or a minimal replacement when parsing fails.
 */
export function sanitizeFileLogLine(message: string): string {
  try {
    const source = JSON.parse(message) as unknown;
    if (!isRecord(source)) {
      return createInvalidRecord();
    }
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (SAFE_SCALAR_FIELDS.has(key) && isSafeScalar(value)) {
        projected[key] = sanitizeScalar(value);
      } else if (SAFE_ARRAY_FIELDS.has(key) && Array.isArray(value)) {
        projected[key] = value.filter(isSafeScalar).slice(0, 100).map(sanitizeScalar);
      } else if (key === 'err' && isRecord(value)) {
        projected.err = sanitizeError(value);
      } else if (key === 'req' && isRecord(value) && typeof value.method === 'string') {
        projected.req = { method: sanitizeString(value.method) };
      } else if (key === 'res' && isRecord(value) && typeof value.statusCode === 'number') {
        projected.res = { statusCode: value.statusCode };
      }
    }
    return `${JSON.stringify(projected)}\n`;
  } catch {
    return createInvalidRecord();
  }
}

/**
 * Keeps only non-message error identity because infrastructure messages and stacks may contain secrets.
 */
function sanitizeError(error: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = { message: REDACTED_VALUE };
  if (typeof error.type === 'string') {
    projected.type = sanitizeString(error.type);
  }
  if (isSafeScalar(error.code)) {
    projected.code = sanitizeScalar(error.code);
  }
  return projected;
}

/**
 * Produces a stable event when an unexpected destination input cannot be parsed safely.
 */
function createInvalidRecord(): string {
  return `${JSON.stringify({
    level: 50,
    service: 'octopus-server',
    schemaVersion: 1,
    event: 'server.file-log.invalid-record',
    errorCode: 'SERVER_FILE_LOG_INVALID_RECORD',
  })}\n`;
}

/**
 * Narrows JSON objects while rejecting arrays and null.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Restricts persisted leaf values to bounded primitive metadata.
 */
function isSafeScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * Bounds strings while preserving numeric, boolean, and null metadata.
 */
function sanitizeScalar(value: string | number | boolean | null): string | number | boolean | null {
  return typeof value === 'string' ? sanitizeString(value) : value;
}

/**
 * Removes control characters and prevents unbounded persistent records.
 */
function sanitizeString(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? ' ' : character;
  })
    .join('')
    .slice(0, MAX_STRING_LENGTH);
}
