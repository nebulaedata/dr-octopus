/**
 * @author Codex
 * @description Canonicalizes the execution contract separately from schedule and presentation revisions.
 */
import { createHash } from 'node:crypto';

/**
 * Include only fields that change execution authority; changing the grant tool scope requires separate approval.
 */
export function executionDigest(task: {
  prompt: string;
  cwd: string;
  workspaceId: string;
  configRevision: string;
  timeoutMs: number;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([1, task.workspaceId, task.cwd, task.configRevision, task.prompt, task.timeoutMs]))
    .digest('hex');
}
