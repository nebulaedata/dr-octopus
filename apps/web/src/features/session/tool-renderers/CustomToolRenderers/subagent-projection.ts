/**
 * @author Codex
 * @description Defensively projects pi-subagents structured tool details into compact presentation records.
 */

import { isRecord, readString } from '../tool-renderer-utils';
import type { ToolProjection } from '@/stores/session';

export interface SubagentChildProjection {
  index: number;
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'stopped' | 'detached';
  task?: string;
  currentTool?: string;
  tokens?: number;
  durationMs?: number;
  output?: string;
  error?: string;
}

export interface SubagentDetailsProjection {
  mode?: string;
  runId?: string;
  background: boolean;
  children: SubagentChildProjection[];
}

/**
 * Projects the extension-owned details contract without parsing model-facing text.
 *
 * @param tool Browser ToolProjection.
 * @returns Safe fields used by the Subagent renderer.
 */
export function projectSubagentDetails(tool: ToolProjection): SubagentDetailsProjection {
  const details = isRecord(tool.details) ? tool.details : {};
  const children = new Map<number, SubagentChildProjection>();
  readProgress(details['progress'], children);
  readResults(details['results'], children);
  return {
    mode: readString(details, 'mode'),
    runId: readString(details, 'runId') ?? readString(details, 'asyncId'),
    background: details['background'] === true,
    children: [...children.values()].sort((left, right) => left.index - right.index),
  };
}

/**
 * Builds the collapsed ToolCard summary from structured subagent state.
 *
 * @param tool Browser ToolProjection.
 * @returns A short progress or completion label.
 */
export function summarizeSubagent(tool: ToolProjection): string | undefined {
  const projection = projectSubagentDetails(tool);
  if (projection.background && projection.children.length === 0) {
    return projection.runId === undefined ? 'Background run started' : `Background · ${projection.runId}`;
  }
  if (projection.children.length === 0) {
    return projection.mode;
  }
  const completed = projection.children.filter((child) => child.status === 'completed').length;
  const active = projection.children.find((child) => child.status === 'running');
  return active === undefined
    ? `${String(completed)}/${String(projection.children.length)} completed`
    : `${String(completed)}/${String(projection.children.length)} completed · ${active.agent} running`;
}

/**
 * Reads live progress rows into the child identity map.
 *
 * @param value Candidate progress list.
 * @param children Mutable projection map keyed by stable child index.
 */
function readProgress(value: unknown, children: Map<number, SubagentChildProjection>): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    if (!isRecord(item) || !Number.isInteger(item['index']) || typeof item['agent'] !== 'string') {
      continue;
    }
    const index = Number(item['index']);
    const status = readStatus(item['status']);
    children.set(index, {
      index,
      agent: item['agent'],
      status,
      ...(readString(item, 'task') === undefined ? {} : { task: readString(item, 'task') }),
      ...(readString(item, 'currentTool') === undefined
        ? {}
        : { currentTool: readString(item, 'currentTool') }),
      ...(typeof item['tokens'] === 'number' ? { tokens: item['tokens'] } : {}),
      ...(typeof item['durationMs'] === 'number' ? { durationMs: item['durationMs'] } : {}),
      ...(readString(item, 'error') === undefined ? {} : { error: readString(item, 'error') }),
    });
  }
}

/**
 * Overlays terminal child results over live progress rows.
 *
 * @param value Candidate result list.
 * @param children Mutable projection map keyed by stable child index.
 */
function readResults(value: unknown, children: Map<number, SubagentChildProjection>): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    if (!isRecord(item) || !Number.isInteger(item['index']) || typeof item['agent'] !== 'string') {
      continue;
    }
    const index = Number(item['index']);
    const previous = children.get(index);
    const error = readString(item, 'error');
    const failed = error !== undefined || item['exitCode'] !== 0;
    const execution = isRecord(item['execution']) ? item['execution'] : undefined;
    children.set(index, {
      ...previous,
      index,
      agent: item['agent'],
      status:
        item['detached'] === true || execution?.['status'] === 'detached'
          ? 'detached'
          : item['stopped'] === true || execution?.['status'] === 'stopped'
            ? 'stopped'
            : execution?.['status'] === 'paused'
              ? 'paused'
              : failed
                ? 'failed'
                : 'completed',
      ...(readString(item, 'task') === undefined ? {} : { task: readString(item, 'task') }),
      ...(readString(item, 'finalOutput') === undefined ? {} : { output: readString(item, 'finalOutput') }),
      ...(error === undefined ? {} : { error }),
      ...(isRecord(item['usage']) ? { tokens: sumUsageTokens(item['usage']) } : {}),
    });
  }
}

/**
 * Narrows a live child status with a safe pending fallback.
 *
 * @param value Candidate status.
 * @returns Supported renderer status.
 */
function readStatus(value: unknown): SubagentChildProjection['status'] {
  return value === 'running' || value === 'completed' || value === 'failed' || value === 'detached'
    ? value
    : 'pending';
}

/**
 * Sums the public input and output token fields.
 *
 * @param usage Candidate usage record.
 * @returns Non-negative token total when available.
 */
function sumUsageTokens(usage: Record<string, unknown>): number {
  return ['input', 'output', 'cacheRead', 'cacheWrite'].reduce(
    (total, key) => total + (typeof usage[key] === 'number' ? usage[key] : 0),
    0
  );
}
