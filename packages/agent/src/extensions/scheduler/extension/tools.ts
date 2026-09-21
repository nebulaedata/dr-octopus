/**
 * @author Codex
 * @description Registers strict model-facing scheduler tools whose success follows the Agent daemon commit.
 */
import { Type } from 'typebox';
import { scheduledTaskInputSchema, scheduledTaskPatchSchema } from '@octopus/shared/protocol/scheduled-tasks';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type {
  SchedulerControlClient,
  SchedulerRequest,
  SchedulerRequestCaller,
} from '../definitions/port.js';

/**
 * Capture source Session identity from Pi context rather than accepting it from model arguments.
 */
function caller(ctx: ExtensionContext | undefined): SchedulerRequestCaller {
  return ctx ? { originSessionRef: ctx.sessionManager.getSessionId() } : {};
}

/**
 * Shares Shared's JSON-schema projection with TypeBox without introducing a second validation contract.
 */
export function registerSchedulerTools(pi: ExtensionAPI, client: SchedulerControlClient): void {
  const taskId = Type.String({ minLength: 1, maxLength: 100 });
  const tools = [
    {
      name: 'scheduler_create',
      operation: 'create',
      parameters: Type.Unsafe<Record<string, unknown>>(
        scheduledTaskInputSchema.toJSONSchema({ io: 'input' })
      ),
    },
    {
      name: 'scheduler_list',
      operation: 'list',
      parameters: Type.Object(
        {
          limit: Type.Optional(
            Type.Integer({
              minimum: 1,
              maximum: 100,
              description: 'Default 5. Use 1 for very large prompts.',
            })
          ),
          offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
        },
        { additionalProperties: false }
      ),
    },
    {
      name: 'scheduler_get',
      operation: 'get',
      parameters: Type.Object({ taskId }, { additionalProperties: false }),
    },
    {
      name: 'scheduler_update',
      operation: 'update',
      parameters: Type.Object(
        {
          taskId,
          revision: Type.Integer({ minimum: 1 }),
          patch: Type.Unsafe<Record<string, unknown>>(scheduledTaskPatchSchema.toJSONSchema({ io: 'input' })),
        },
        { additionalProperties: false }
      ),
    },
    {
      name: 'scheduler_delete',
      operation: 'delete',
      parameters: Type.Object(
        { taskId, revision: Type.Integer({ minimum: 1 }) },
        { additionalProperties: false }
      ),
    },
    {
      name: 'scheduler_run_now',
      operation: 'run-now',
      parameters: Type.Object({ taskId }, { additionalProperties: false }),
    },
    {
      name: 'scheduler_cancel',
      operation: 'cancel',
      parameters: Type.Object(
        { taskId, runId: Type.String({ minLength: 1, maxLength: 100 }) },
        { additionalProperties: false }
      ),
    },
    {
      name: 'scheduler_history',
      operation: 'history',
      parameters: Type.Object(
        {
          taskId,
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
        },
        { additionalProperties: false }
      ),
    },
  ] as const;
  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.name.replaceAll('_', ' '),
      description: `Manage Agent-owned persistent scheduled tasks for this Session (${tool.operation}). Schedules use explicit timezone/offset. Mutations wait for daemon commit; each run uses an isolated Session. Creation saves a task pending persistent user authorization; direct the user to the task authorization screen or /scheduler-authorize. Never promise execution before authorization. The runner supplies execution time; avoid shell commands just to read the date.`,
      parameters: tool.parameters,
      async execute(toolCallId, parameters, signal, _onUpdate, ctx) {
        const params = parameters as Record<string, unknown>;
        const request: SchedulerRequest = {
          operation: tool.operation,
          key: toolCallId,
          ...(signal ? { signal } : {}),
          ...(typeof params.taskId === 'string' ? { taskId: params.taskId } : {}),
          ...(typeof params.revision === 'number' ? { revision: params.revision } : {}),
          ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
          ...(typeof params.offset === 'number' ? { offset: params.offset } : {}),
          input:
            tool.operation === 'create'
              ? params
              : tool.operation === 'update'
                ? params.patch
                : tool.operation === 'cancel'
                  ? { runId: params.runId }
                  : tool.operation === 'list' || tool.operation === 'history'
                    ? { limit: params.limit, offset: params.offset }
                    : {},
        };
        // Pi 0.84.3 AgentToolResult has no isError flag; throwing produces the native error result.
        const result = await client.request(request, caller(ctx));
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      },
    });
  }
}
