/**
 * @author Codex
 * @description Adapts explicit scheduler commands to the same Agent service used by model tools.
 */
import { registerSchedulerAuthorizationCommand } from './authorization-command.js';
import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SchedulerControlClient } from '../definitions/port.js';

const USAGE =
  'Usage: /scheduler service start|stop|restart|status | status|list|get|history|run|pause|resume|delete|cancel [task-id] [run-id] | settings [timezone <IANA>|concurrency <1-32>]';

/**
 * Validate the minimum task identity needed for revision-guarded commands.
 */
function taskIdentity(value: unknown): { id: string; revision: number } {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as { id?: unknown }).id !== 'string' ||
    !Number.isSafeInteger((value as { revision?: unknown }).revision)
  ) {
    throw new Error('Scheduler returned an invalid task response');
  }
  return value as { id: string; revision: number };
}

/**
 * Uses plain command arguments, fresh revision reads, and a noninteractive-safe custom message.
 */
export function registerSchedulerCommands(pi: ExtensionAPI, client: SchedulerControlClient): void {
  registerSchedulerAuthorizationCommand(pi, client);
  pi.registerCommand('scheduler', {
    description: USAGE,
    async handler(args, ctx) {
      const [action = 'status', taskId, runId, extra] = (args.trim() || 'status').split(/\s+/);
      let result: unknown;
      if (action === 'service') {
        if (!taskId || runId || extra || !['start', 'stop', 'restart', 'status'].includes(taskId)) {
          throw new Error('Usage: /scheduler service start|stop|restart|status');
        }
        if (taskId === 'status') {
          if (!client.status) {
            throw new Error('Scheduler service status is unavailable');
          }
          result = await client.status();
        } else {
          if (!client.controlService) {
            throw new Error('Scheduler service control is unavailable');
          }
          result = await client.controlService(taskId as 'start' | 'stop' | 'restart');
        }
      } else if (action === 'settings') {
        if (
          extra ||
          (taskId !== undefined && !['timezone', 'concurrency'].includes(taskId)) ||
          (taskId && !runId)
        ) {
          throw new Error(USAGE);
        }
        if (!client.getSettings || !client.updateSettings) {
          throw new Error('Scheduler settings are unavailable');
        }
        const current = await client.getSettings();
        if (!taskId) {
          result = current;
        } else if (taskId === 'timezone') {
          result = await client.updateSettings({
            timezone: runId!,
            maxConcurrentRuns: current.maxConcurrentRuns,
            revision: current.revision,
          });
        } else {
          const maxConcurrentRuns = Number(runId);
          if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 32) {
            throw new Error('Scheduler concurrency must be an integer from 1 to 32');
          }
          result = await client.updateSettings({
            timezone: current.timezone,
            maxConcurrentRuns,
            revision: current.revision,
          });
        }
      } else {
        if (
          extra ||
          !['status', 'list', 'get', 'history', 'run', 'pause', 'resume', 'delete', 'cancel'].includes(
            action
          ) ||
          (!['status', 'list'].includes(action) && !taskId) ||
          (action === 'cancel' && !runId) ||
          (action !== 'cancel' && runId)
        ) {
          throw new Error(USAGE);
        }
        const signal = ctx.signal;
        const caller = { originSessionRef: ctx.sessionManager.getSessionId() };
        if (action === 'status' && client.status) {
          result = await client.status();
        } else if (action === 'pause' || action === 'resume' || action === 'delete') {
          const task = taskIdentity(
            await client.request({ operation: 'get', taskId: taskId!, ...(signal ? { signal } : {}) }, caller)
          );
          result = await client.request(
            {
              operation: action === 'delete' ? 'delete' : 'update',
              taskId: task.id,
              revision: task.revision,
              key: randomUUID(),
              input: action === 'delete' ? {} : { enabled: action === 'resume' },
              ...(signal ? { signal } : {}),
            },
            caller
          );
        } else {
          result = await client.request(
            {
              operation:
                action === 'status' || action === 'list'
                  ? 'list'
                  : action === 'run'
                    ? 'run-now'
                    : (action as 'get' | 'history' | 'cancel'),
              ...(taskId ? { taskId } : {}),
              key: randomUUID(),
              input: action === 'cancel' ? { runId } : {},
              ...(signal ? { signal } : {}),
            },
            caller
          );
        }
      }
      const text = JSON.stringify(result);
      if (ctx.hasUI) {
        ctx.ui.notify(text, 'info');
      }
      pi.sendMessage({ customType: 'octopus-scheduler-result', content: text, display: true });
    },
  });
}
