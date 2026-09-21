/**
 * @author Codex
 * @description Validates the pi-subagents RPC widget bridge and projects its vendor framing into a bounded Host DTO.
 */

import type {
  SubagentFleetActivityDto,
  SubagentFleetNodeDto,
  SubagentFleetNodeState,
  SubagentFleetSnapshotDto,
} from '@octopus/shared/protocol';

const WIDGET_KEY = 'subagent-async';
const SNAPSHOT_PREFIX = 'PI_SUBAGENT_ASYNC_JSON:';
const SNAPSHOT_KIND = 'pi-subagents.async-status-snapshot';
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_NODE_COUNT = 256;
const MAX_NODE_DEPTH = 6;
const MAX_STRING_CHARACTERS = 512;

const NODE_KINDS = new Set(['subagent', 'workflow', 'step', 'host-step']);
const NODE_STATES = new Set<SubagentFleetNodeState>([
  'queued',
  'running',
  'complete',
  'failed',
  'partial',
  'paused',
  'stopped',
  'rejected',
]);

export type SubagentFleetProjectionResult =
  | { kind: 'unmatched' }
  | { kind: 'invalid' }
  | { kind: 'snapshot'; snapshot: SubagentFleetSnapshotDto | undefined };

/**
 * Recognizes and validates one RPC-mode pi-subagents widget request.
 *
 * @param payload Raw RpcExtensionUIRequest payload.
 * @returns A discriminated result that preserves unrelated Extension UI requests.
 */
export function projectSubagentFleetPayload(payload: unknown): SubagentFleetProjectionResult {
  if (!isRecord(payload) || payload['method'] !== 'setWidget' || payload['widgetKey'] !== WIDGET_KEY) {
    return { kind: 'unmatched' };
  }
  if (payload['widgetLines'] === undefined) {
    return { kind: 'snapshot', snapshot: undefined };
  }
  const lines = payload['widgetLines'];
  if (!Array.isArray(lines) || lines.length !== 1 || typeof lines[0] !== 'string') {
    return { kind: 'invalid' };
  }
  const line = lines[0];
  if (!line.startsWith(SNAPSHOT_PREFIX) || Buffer.byteLength(line, 'utf8') > MAX_SNAPSHOT_BYTES) {
    return { kind: 'invalid' };
  }
  try {
    const parsed = JSON.parse(line.slice(SNAPSHOT_PREFIX.length)) as unknown;
    const snapshot = parseSnapshot(parsed);
    return snapshot === undefined ? { kind: 'invalid' } : { kind: 'snapshot', snapshot };
  } catch {
    return { kind: 'invalid' };
  }
}

/**
 * Validates the public snapshot envelope while discarding extension-private fields.
 *
 * @param value Parsed widget JSON.
 * @returns The bounded Host DTO when the versioned contract is valid.
 */
function parseSnapshot(value: unknown): SubagentFleetSnapshotDto | undefined {
  if (
    !isRecord(value) ||
    value['kind'] !== SNAPSHOT_KIND ||
    value['version'] !== 1 ||
    !isNonNegativeNumber(value['generatedAt']) ||
    !Array.isArray(value['runs'])
  ) {
    return undefined;
  }
  const omitted = parseOmitted(value['omitted']);
  if (omitted === undefined) {
    return undefined;
  }
  const counter = { value: 0 };
  const runs = parseNodes(value['runs'], 0, counter);
  return runs === undefined
    ? undefined
    : {
        kind: SNAPSHOT_KIND,
        version: 1,
        generatedAt: value['generatedAt'],
        omitted,
        runs,
      };
}

/**
 * Validates snapshot overflow metadata.
 *
 * @param value Candidate omitted-count record.
 * @returns Safe overflow metadata or undefined.
 */
function parseOmitted(value: unknown): SubagentFleetSnapshotDto['omitted'] | undefined {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value['runs']) ||
    !Number.isSafeInteger(value['children']) ||
    Number(value['runs']) < 0 ||
    Number(value['children']) < 0 ||
    typeof value['byteLimitExceeded'] !== 'boolean'
  ) {
    return undefined;
  }
  return {
    runs: Number(value['runs']),
    children: Number(value['children']),
    byteLimitExceeded: value['byteLimitExceeded'],
  };
}

/**
 * Recursively validates the bounded public run tree.
 *
 * @param values Candidate node list.
 * @param depth Current tree depth.
 * @param counter Shared total-node counter.
 * @returns Safe nodes or undefined when any invariant fails.
 */
function parseNodes(
  values: unknown[],
  depth: number,
  counter: { value: number }
): SubagentFleetNodeDto[] | undefined {
  if (depth > MAX_NODE_DEPTH) {
    return undefined;
  }
  const nodes: SubagentFleetNodeDto[] = [];
  for (const value of values) {
    counter.value += 1;
    if (counter.value > MAX_NODE_COUNT) {
      return undefined;
    }
    const node = parseNode(value, depth, counter);
    if (node === undefined) {
      return undefined;
    }
    nodes.push(node);
  }
  return nodes;
}

/**
 * Validates one public Fleet node and its optional activity.
 *
 * @param value Candidate node record.
 * @param depth Current tree depth.
 * @param counter Shared total-node counter.
 * @returns Safe node or undefined.
 */
function parseNode(
  value: unknown,
  depth: number,
  counter: { value: number }
): SubagentFleetNodeDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readBoundedString(value['id']);
  const label = readBoundedString(value['label']);
  const kind = value['kind'];
  const state = value['state'];
  if (
    id === undefined ||
    label === undefined ||
    typeof kind !== 'string' ||
    !NODE_KINDS.has(kind) ||
    typeof state !== 'string' ||
    !NODE_STATES.has(state as SubagentFleetNodeState) ||
    !hasValidOptionalNumbers(value, ['startedAt', 'updatedAt', 'endedAt'])
  ) {
    return undefined;
  }
  const activity = value['activity'] === undefined ? undefined : parseActivity(value['activity']);
  if (value['activity'] !== undefined && activity === undefined) {
    return undefined;
  }
  const children = value['children'];
  const projectedChildren =
    children === undefined
      ? undefined
      : Array.isArray(children)
        ? parseNodes(children, depth + 1, counter)
        : undefined;
  if (children !== undefined && projectedChildren === undefined) {
    return undefined;
  }
  return {
    id,
    kind: kind as SubagentFleetNodeDto['kind'],
    label,
    state: state as SubagentFleetNodeState,
    ...copyOptionalNumber(value, 'startedAt'),
    ...copyOptionalNumber(value, 'updatedAt'),
    ...copyOptionalNumber(value, 'endedAt'),
    ...(activity === undefined ? {} : { activity }),
    ...(projectedChildren === undefined ? {} : { children: projectedChildren }),
  };
}

/**
 * Validates one activity projection.
 *
 * @param value Candidate activity record.
 * @returns Safe activity or undefined.
 */
function parseActivity(value: unknown): SubagentFleetActivityDto | undefined {
  if (
    !isRecord(value) ||
    !hasValidOptionalNumbers(value, ['lastActivityAt', 'currentToolStartedAt', 'turnCount', 'toolCount'])
  ) {
    return undefined;
  }
  const state = readOptionalBoundedString(value['state']);
  const currentTool = readOptionalBoundedString(value['currentTool']);
  if (state === null || currentTool === null) {
    return undefined;
  }
  return {
    ...(state === undefined ? {} : { state }),
    ...(currentTool === undefined ? {} : { currentTool }),
    ...copyOptionalNumber(value, 'lastActivityAt'),
    ...copyOptionalNumber(value, 'currentToolStartedAt'),
    ...copyOptionalNumber(value, 'turnCount'),
    ...copyOptionalNumber(value, 'toolCount'),
  };
}

/**
 * Checks a fixed set of optional non-negative numeric fields.
 *
 * @param value Source record.
 * @param keys Numeric keys to validate.
 * @returns Whether every present field is finite and non-negative.
 */
function hasValidOptionalNumbers(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => value[key] === undefined || isNonNegativeNumber(value[key]));
}

/**
 * Copies one validated optional numeric field.
 *
 * @param value Source record.
 * @param key Field name.
 * @returns A spreadable field record.
 */
function copyOptionalNumber(value: Record<string, unknown>, key: string): Record<string, number> {
  return value[key] === undefined ? {} : { [key]: value[key] as number };
}

/**
 * Reads a required bounded display string.
 *
 * @param value Candidate string.
 * @returns Non-empty bounded text or undefined.
 */
function readBoundedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING_CHARACTERS
    ? value
    : undefined;
}

/**
 * Reads an optional bounded display string and distinguishes invalid input.
 *
 * @param value Candidate optional string.
 * @returns String, undefined when omitted, or null when invalid.
 */
function readOptionalBoundedString(value: unknown): string | undefined | null {
  return value === undefined ? undefined : (readBoundedString(value) ?? null);
}

/**
 * Narrows an arbitrary value to a record.
 *
 * @param value Candidate value.
 * @returns Whether named fields are safe to read.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks a non-negative safe integer.
 *
 * @param value Candidate number.
 * @returns Whether the value is safe for timing or count projection.
 */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
