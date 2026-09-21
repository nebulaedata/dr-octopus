/**
 * @author Codex
 * @description Runs one bounded SDK inspection child only when a caller requests the authorization catalog.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { taskToolCatalogEntrySchema } from '@octopus/shared/protocol/scheduled-tasks';
import { resolveOctopusCliPath } from '../../../cli/path.js';
import { executionDigest } from '../services/execution-digest.js';
import { SchedulerTaskError } from '../definitions/task-error.js';
import type { SchedulerTaskRecord } from '../definitions/tasks.js';
import type { TaskToolCatalogEntry } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Await child exit as well as its result; a timeout or initialization failure never returns a partial catalog.
 */
export async function inspectTaskTools(
  agentDir: string,
  directory: string,
  profileId: string,
  task: SchedulerTaskRecord,
  options: { cliPath?: string; timeoutMs?: number } = {}
): Promise<TaskToolCatalogEntry[]> {
  const sessionId = randomUUID();
  const inspectionRoot = resolve(directory, 'inspections');
  const inspectionDirectory = resolve(inspectionRoot, sessionId);
  if (relative(inspectionRoot, inspectionDirectory) !== sessionId) {
    throw new Error('Invalid inspection path.');
  }
  const child = spawn(
    process.execPath,
    [
      '--max-old-space-size=1024',
      options.cliPath ?? resolveOctopusCliPath(),
      '--mode',
      'rpc',
      '--workspace',
      task.workspaceId,
    ],
    {
      cwd: task.cwd,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        ...process.env,
        DR_OCTOPUS_CODING_AGENT_DIR: resolve(agentDir),
        // Match RPC execution: upstream extensions must inspect the same profile.
        PI_CODING_AGENT_DIR: resolve(agentDir),
        DR_OCTOPUS_PROCESS_ROLE: 'task-tool-inspection',
        CONTEXT_MODE_DATA_DIR: inspectionDirectory,
        CONTEXT_MODE_DIR: resolve(inspectionDirectory, 'context-mode'),
        DR_OCTOPUS_PERMISSION_EXECUTION: JSON.stringify({
          profileId,
          subjectId: task.id,
          workspaceId: task.workspaceId,
          executionDigest: executionDigest(task),
          sessionId,
          attemptId: randomUUID(),
          cwd: task.cwd,
          ref: null,
          inspect: true,
        }),
      },
    }
  );
  try {
    return await new Promise<TaskToolCatalogEntry[]>((resolveResult, reject) => {
      let result: TaskToolCatalogEntry[] | undefined;
      let reason = 'Tool inspection did not complete.';
      let failed = false;
      const timeout = setTimeout(() => {
        failed = true;
        reason = 'Tool inspection timed out; refresh the authorization list to retry.';
        child.kill('SIGKILL');
      }, options.timeoutMs ?? 45_000);
      child.on('message', (message: unknown) => {
        if (
          !message ||
          typeof message !== 'object' ||
          !('type' in message) ||
          message.type !== 'authorization-inspection'
        ) {
          return;
        }
        const data = message as { success?: boolean; tools?: unknown; reason?: unknown };
        const parsed = taskToolCatalogEntrySchema.array().safeParse(data.tools);
        if (!failed && data.success === true && parsed.success && !result) {
          result = parsed.data;
        } else {
          failed = true;
          reason =
            typeof data.reason === 'string' ? data.reason.slice(0, 1000) : 'Invalid tool inspection result.';
        }
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(
          new SchedulerTaskError(
            'SCHEDULE_AUTHORIZATION_UNAVAILABLE',
            `Cannot start tool inspection: ${error.message}`
          )
        );
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 && result && !failed) {
          resolveResult(result);
        } else {
          reject(new SchedulerTaskError('SCHEDULE_AUTHORIZATION_UNAVAILABLE', reason));
        }
      });
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await rm(inspectionDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
