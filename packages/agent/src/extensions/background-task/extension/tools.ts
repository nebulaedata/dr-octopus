/**
 * @author Codex
 * @description Registers the bounded background task model surface with per-action validation.
 */
import { isBackgroundTaskActive } from '@octopus/shared/protocol';
import { assertManagedCommand } from './guard.js';
import { backgroundTaskSchema, parseBackgroundTaskInput } from '../validators/tool-input.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { BackgroundTaskManager } from '../services/task-manager.js';

/**
 * Uses current session cwd and bash permission eligibility; tool returns never imply service readiness.
 */
export function registerBackgroundTools(pi: ExtensionAPI, service: BackgroundTaskManager): void {
  pi.registerTool({
    name: 'background_task',
    label: 'Background task',
    parameters: backgroundTaskSchema,
    description: [
      'Manage long-running commands with start/list/status/logs/wait/stop, using taskId after start. Commands use bash in the current workspace (no custom shell prefix).',
      'Run workloads in foreground / no-daemon mode; all descendants must remain under Agent cleanup. Do not delegate to detached or external launchers.',
      'start confirms launch, not readiness; verify logs or a bounded health check. Normal replies keep tasks alive; user Stop, session shutdown, and host exit end their lifetime.',
      'Stop tasks when no longer needed and confirm termination. Cancelling wait does not stop a task; use stop.',
    ].join(' '),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!pi.getActiveTools().includes('background_task')) {
        throw new Error('NOT_AUTHORIZED');
      }
      const params = parseBackgroundTaskInput(input);
      let result: unknown;
      switch (params.action) {
        case 'start':
          if (!pi.getActiveTools().includes('bash')) {
            throw new Error('NOT_AUTHORIZED: bash is unavailable in this mode');
          }
          {
            const plan = ctx.sessionManager
              .getBranch()
              .slice()
              .reverse()
              .find((entry) => entry.type === 'custom' && entry.customType === 'plan-mode-state');
            if (
              plan?.type === 'custom' &&
              (!plan.data ||
                typeof plan.data !== 'object' ||
                !('enabled' in plan.data) ||
                plan.data.enabled !== false)
            ) {
              throw new Error('NOT_AUTHORIZED: background processes are unavailable in Plan mode');
            }
          }
          assertManagedCommand(params.command);
          result = await service.start(
            params.command,
            ctx.cwd,
            params.label ?? 'Background task',
            params.requestId ?? toolCallId,
            signal
          );
          break;
        case 'list':
          result = service.snapshot();
          break;
        case 'status':
          result = service.status(params.taskId);
          break;
        case 'logs':
          result = service.readLogs(params.taskId, params.cursor, params.limitBytes);
          break;
        case 'wait':
          result = await service.wait(params.taskId, params.timeoutMs, signal);
          break;
        case 'stop': {
          service.stop(params.taskId);
          const task = await service.wait(params.taskId, 10000, signal);
          if (isBackgroundTaskActive(task)) {
            throw new Error('STOP_TIMEOUT');
          }
          result = task;
          break;
        }
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: { schemaVersion: 1, result },
      };
    },
  });
}
