/**
 * @author Codex
 * @description Streams bounded filtered reads from the permission review JSONL file.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  getPermissionReviewLogDirectory,
  isFileNotFoundError,
  listPermissionReviewLogFiles,
} from './permission-review-log-files.js';
import type { PermissionReviewLogReader } from '../definitions/port.js';
import type {
  PermissionReviewEntry,
  PermissionReviewQuery,
  PermissionReviewQueryResult,
} from '../definitions/types.js';

/**
 * Reads controlled process-owned audit shards without granting callers arbitrary path access.
 */
export class FilePermissionReviewLogReader implements PermissionReviewLogReader {
  private readonly logsDir: string;

  /**
   * Creates a reader for the managed review-log directory.
   *
   * @param agentDir Pi Agent user directory.
   */
  public constructor(agentDir: string) {
    this.logsDir = getPermissionReviewLogDirectory(agentDir);
  }

  /**
   * Streams all managed JSONL shards while retaining only the newest bounded matches.
   *
   * @param query Exact filters and bounded result limit.
   * @param signal Optional cancellation signal from Pi.
   * @returns Matching entries in chronological order plus scan diagnostics.
   */
  public async query(
    query: PermissionReviewQuery,
    signal?: AbortSignal
  ): Promise<PermissionReviewQueryResult> {
    throwIfAborted(signal);
    const paths = listPermissionReviewLogFiles(this.logsDir);
    if (paths.length === 0) {
      return createEmptyQueryResult();
    }
    const entries: PermissionReviewEntry[] = [];
    let matched = 0;
    let malformedLines = 0;

    for (const path of paths) {
      const result = await scanReviewLogFile(path, query, signal);
      matched += result.matched;
      malformedLines += result.malformedLines;
      for (const entry of result.entries) {
        retainNewestEntry(entries, entry, query.limit);
      }
    }
    return {
      entries,
      matched,
      malformedLines,
      truncated: matched > entries.length,
      logExists: true,
    };
  }
}

/**
 * Scans one process-owned segment and tolerates concurrent retention removal.
 *
 * @param path Exact managed segment path.
 * @param query Requested filters.
 * @param signal Optional tool cancellation signal.
 * @returns Bounded matches and malformed-line count for this segment.
 */
async function scanReviewLogFile(
  path: string,
  query: PermissionReviewQuery,
  signal?: AbortSignal
): Promise<{ entries: PermissionReviewEntry[]; matched: number; malformedLines: number }> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const abort = (): void => {
    stream.destroy(createAbortError());
  };
  signal?.addEventListener('abort', abort, { once: true });
  const entries: PermissionReviewEntry[] = [];
  let matched = 0;
  let malformedLines = 0;

  try {
    for await (const line of lines) {
      throwIfAborted(signal);
      if (line.trim().length === 0) {
        continue;
      }
      const entry = parseReviewEntry(line);
      if (entry === undefined) {
        malformedLines += 1;
      } else if (matchesReviewQuery(entry, query)) {
        matched += 1;
        retainNewestEntry(entries, entry, query.limit);
      }
    }
    return { entries, matched, malformedLines };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return { entries: [], matched: 0, malformedLines: 0 };
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    lines.close();
    stream.destroy();
  }
}

/**
 * Keeps the newest timestamped entries in chronological order across all process shards.
 *
 * @param entries Mutable bounded result set.
 * @param entry Candidate matching record.
 * @param limit Maximum retained records.
 */
function retainNewestEntry(
  entries: PermissionReviewEntry[],
  entry: PermissionReviewEntry,
  limit: number
): void {
  entries.push(entry);
  entries.sort(compareReviewEntries);
  if (entries.length > limit) {
    entries.shift();
  }
}

/**
 * Orders review entries by timestamp with deterministic JSON fallback.
 *
 * @param left First review entry.
 * @param right Second review entry.
 * @returns Standard sort comparison.
 */
function compareReviewEntries(left: PermissionReviewEntry, right: PermissionReviewEntry): number {
  const leftTimestamp = getReviewTimestamp(left);
  const rightTimestamp = getReviewTimestamp(right);
  return leftTimestamp - rightTimestamp || JSON.stringify(left).localeCompare(JSON.stringify(right));
}

/**
 * Converts one optional timestamp to a sortable value.
 *
 * @param entry Review entry.
 * @returns Parsed epoch or negative infinity for missing and invalid timestamps.
 */
function getReviewTimestamp(entry: PermissionReviewEntry): number {
  const timestamp = entry['timestamp'];
  if (typeof timestamp !== 'string') {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Creates the stable absent-log result.
 *
 * @returns Empty query result.
 */
function createEmptyQueryResult(): PermissionReviewQueryResult {
  return {
    entries: [],
    matched: 0,
    malformedLines: 0,
    truncated: false,
    logExists: false,
  };
}

/**
 * Parses one JSONL record and rejects primitives or arrays.
 *
 * @param line One physical review-log line.
 * @returns Parsed entry or undefined when malformed.
 */
function parseReviewEntry(line: string): PermissionReviewEntry | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Applies exact audit filters and an inclusive timestamp lower bound.
 *
 * @param entry Parsed review event.
 * @param query Requested filters.
 * @returns Whether the event belongs in the result set.
 */
function matchesReviewQuery(entry: PermissionReviewEntry, query: PermissionReviewQuery): boolean {
  return (
    matchesExactString(entry, 'requestId', query.requestId) &&
    matchesExactString(entry, 'sessionId', query.sessionId) &&
    matchesExactString(entry, 'toolName', query.toolName) &&
    matchesExactString(entry, 'resolution', query.resolution) &&
    matchesExactString(entry, 'event', query.event) &&
    matchesSince(entry, query.since)
  );
}

/**
 * Matches an optional exact string filter.
 *
 * @param entry Parsed review event.
 * @param field Stable audit field name.
 * @param expected Optional exact value.
 * @returns Whether the filter is absent or equal.
 */
function matchesExactString(
  entry: PermissionReviewEntry,
  field: string,
  expected: string | undefined
): boolean {
  return expected === undefined || entry[field] === expected;
}

/**
 * Applies an inclusive timestamp lower bound to a review entry.
 *
 * @param entry Parsed review event.
 * @param since Optional valid ISO timestamp.
 * @returns Whether the event timestamp is valid and at or after the lower bound.
 */
function matchesSince(entry: PermissionReviewEntry, since: string | undefined): boolean {
  if (since === undefined) {
    return true;
  }
  const timestamp = entry['timestamp'];
  return typeof timestamp === 'string' && Date.parse(timestamp) >= Date.parse(since);
}

/**
 * Distinguishes JSON records from primitives and arrays.
 *
 * @param value Parsed JSON value.
 * @returns Whether the value is a record.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Creates the standard cancellation shape expected by Pi tool execution.
 *
 * @returns AbortError instance.
 */
function createAbortError(): Error {
  const error = new Error('Permission audit query was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * Stops a streaming query promptly when its owning Pi call is cancelled.
 *
 * @param signal Optional tool cancellation signal.
 * @throws AbortError when cancellation has been requested.
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw createAbortError();
  }
}
