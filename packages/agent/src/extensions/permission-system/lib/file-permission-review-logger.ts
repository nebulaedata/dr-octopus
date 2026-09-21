/**
 * @author Codex
 * @description Appends bounded and structurally redacted permission decisions to process-owned JSONL shards.
 */

import { ShardedPermissionReviewLogStorage } from './permission-review-log-storage.js';
import type { PermissionReviewLogger } from '../definitions/port.js';
import type { PermissionReviewEvent } from '../definitions/types.js';
import type { PermissionReviewLogStorageOptions } from './permission-review-log-storage.js';

const EXTENSION_ID = 'pi-permission-system';
const REDACTED_PLACEHOLDER = '[redacted]';
const SENSITIVE_KEY_PATTERN =
  /authorization|api[-_]?key|secret|token|password|passwd|credential|cookie|private[-_]?key/i;

/**
 * Serializes tool input for the review log before its object keys are flattened into a string.
 *
 * @param input Raw Pi tool input.
 * @returns Compact structurally redacted preview, or null for an empty payload.
 */
export function serializeRedactedToolInputPreview(input: unknown): string | null {
  const serialized = redactedJsonStringify(input);
  if (serialized === undefined || serialized === '{}' || serialized === 'null') {
    return null;
  }
  return serialized.replace(/\s+/gu, ' ').trim();
}

/**
 * Owns append-only permission audit persistence for all sessions in one Agent directory.
 */
export class FilePermissionReviewLogger implements PermissionReviewLogger {
  private readonly storage: ShardedPermissionReviewLogStorage;
  private readonly reportedWarnings = new Set<string>();

  /**
   * Creates a logger without touching disk until its first review event.
   *
   * @param agentDir Pi Agent user directory.
   * @param storageOptions Optional deterministic storage overrides.
   */
  public constructor(agentDir: string, storageOptions: PermissionReviewLogStorageOptions = {}) {
    this.storage = new ShardedPermissionReviewLogStorage(agentDir, storageOptions);
  }

  /**
   * Appends one bounded and redacted JSON object as a single line.
   *
   * @param event Stable review event name.
   * @param details Structured request and decision facts.
   * @param maxFieldWidth Maximum characters retained for every nested string value.
   * @returns A deduplicated warning when persistence fails, otherwise undefined.
   */
  public write(
    event: PermissionReviewEvent,
    details: Readonly<Record<string, unknown>>,
    maxFieldWidth: number
  ): string | undefined {
    try {
      const line = redactedJsonStringify({
        timestamp: new Date().toISOString(),
        extension: EXTENSION_ID,
        stream: 'review',
        event,
        ...capLogFieldWidths(details, maxFieldWidth),
      });
      if (line === undefined) {
        return this.reportOnce(
          `Failed to write permission-system review log: event could not be serialized.`
        );
      }
      const warning = this.storage.append(line);
      return warning === undefined ? undefined : this.reportOnce(warning);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.reportOnce(`Failed to write permission-system review log: ${message}`);
    }
  }

  /**
   * Suppresses repeated user-facing warnings for the same persistent IO failure.
   *
   * @param warning Stable failure message.
   * @returns The first occurrence, otherwise undefined.
   */
  private reportOnce(warning: string): string | undefined {
    if (this.reportedWarnings.has(warning)) {
      return undefined;
    }
    this.reportedWarnings.add(warning);
    return warning;
  }
}

/**
 * Recursively bounds every string while preserving non-plain runtime values.
 *
 * @param value Candidate structured details.
 * @param maxWidth Maximum retained string length.
 * @returns A structurally equivalent bounded value.
 */
function capLogFieldWidths<T>(value: T, maxWidth: number): T {
  return capValue(value, maxWidth) as T;
}

/**
 * Applies the field-width limit to one nested value.
 *
 * @param value Candidate nested value.
 * @param maxWidth Maximum retained string length.
 * @returns Bounded nested value.
 */
function capValue(value: unknown, maxWidth: number): unknown {
  if (typeof value === 'string') {
    return value.length <= maxWidth ? value : `${value.slice(0, maxWidth)}…`;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => capValue(entry, maxWidth));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, capValue(entry, maxWidth)]));
  }
  return value;
}

/**
 * Distinguishes records safe to rebuild from class instances with serialization behavior.
 *
 * @param value Candidate nested value.
 * @returns Whether the value is a plain record.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Serializes cyclic and non-JSON-native values while masking credential-bearing keys.
 *
 * @param value Structured log entry.
 * @returns JSON text, or undefined when JSON.stringify produced no value.
 */
function redactedJsonStringify(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (key, rawValue: unknown) => {
    const currentValue =
      rawValue !== null && rawValue !== undefined && SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED_PLACEHOLDER
        : rawValue;
    if (currentValue instanceof Error) {
      return {
        name: currentValue.name,
        message: currentValue.message,
        stack: currentValue.stack,
      };
    }
    if (typeof currentValue === 'bigint') {
      return currentValue.toString();
    }
    if (typeof currentValue === 'object' && currentValue !== null) {
      if (seen.has(currentValue)) {
        return '[Circular]';
      }
      seen.add(currentValue);
    }
    return currentValue;
  });
}
