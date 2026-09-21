/**
 * @author Codex
 * @description Exposes durable task approval only through an explicit user command and confirmation UI.
 */
import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { TaskAuthorizationPreview } from '@octopus/shared/protocol/scheduled-tasks';
import type { SchedulerControlClient } from '../definitions/port.js';
import type { SchedulerTask } from '../definitions/tasks.js';

/**
 * Review a precise task revision and select tools individually; cancellation grants nothing.
 */
export function registerSchedulerAuthorizationCommand(
  pi: ExtensionAPI,
  client: SchedulerControlClient
): void {
  pi.registerCommand('scheduler-authorize', {
    description:
      'Usage: /scheduler-authorize <task-id> [revoke]. Persistent user approval; never a model tool.',
    async handler(args, ctx) {
      const [taskId, action, extra] = args.trim().split(/\s+/);
      if (!taskId || extra || (action && action !== 'revoke') || !ctx.hasUI) {
        throw new Error('Use /scheduler-authorize <task-id> [revoke] in an interactive user session.');
      }
      const caller = { originSessionRef: ctx.sessionManager.getSessionId() };
      const task = (await client.request({ operation: 'get', taskId }, caller)) as SchedulerTask;
      if (action === 'revoke') {
        if (await ctx.ui.confirm('Revoke task authorization', task.name)) {
          await client.request(
            {
              operation: 'revoke-authorization',
              taskId,
              revision: task.revision,
              key: randomUUID(),
              input: {},
            },
            caller
          );
        }
        return;
      }
      const preview = (await client.request(
        { operation: 'authorization-preview', taskId },
        caller
      )) as TaskAuthorizationPreview;
      if (preview.taskRevision !== task.revision) {
        throw new Error('Task changed; review again.');
      }
      const names = await ctx.ui.input(
        'Tools to authorize (comma-separated exact names)',
        preview.tools.map((tool) => tool.name).join(', ')
      );
      if (names === undefined) {
        return;
      }
      const selected = new Set(
        names
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
      );
      if ([...selected].some((name) => !preview.tools.some((tool) => tool.name === name))) {
        throw new Error('Unknown tool name.');
      }
      const tools = preview.tools.filter((tool) => selected.has(tool.name));
      const approved = await ctx.ui.confirm(
        'Persist authorization for this task?',
        `${task.name}\n${task.prompt}\nDirectory: ${preview.cwd}\nTools: ${tools.map((tool) => tool.name).join(', ') || '(none)'}\nSelected tools receive full tool capability. Shell is not limited to date. Valid until revoked or execution content changes. No automatic replay.`
      );
      if (!approved) {
        return;
      }
      await client.request(
        {
          operation: 'authorize',
          taskId,
          revision: task.revision,
          key: randomUUID(),
          input: { confirmed: true, executionDigest: preview.executionDigest, tools },
        },
        caller
      );
      ctx.ui.notify('Task authorization saved. Future runs can use the selected tools.', 'info');
    },
  });
}
