/**
 * @author Codex
 * @description Provides shared stateless helpers for Pi RPC responses and canonical Workspace values.
 */

import { canonicalizePath, isRecord } from '../../utils/index.js';
import type { WorkspaceDescriptor } from '@octopus/agent';

/**
 * Detects successful Pi responses before applying local projections.
 */
export function responseSucceeded(response: unknown): boolean {
  return isRecord(response) && response['success'] === true;
}

/**
 * Extracts data only from successful Pi responses.
 */
export function responseData<T = unknown>(response: unknown): T | undefined {
  return responseSucceeded(response) ? (response as { data?: T }).data : undefined;
}

/**
 * Resolves the Workspace launch cwd before it becomes part of a runtime identity.
 */
export async function canonicalizeWorkspace(workspace: WorkspaceDescriptor): Promise<WorkspaceDescriptor> {
  return { ...workspace, cwd: await canonicalizePath(workspace.cwd) };
}
