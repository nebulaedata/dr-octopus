/**
 * @author Codex
 * @description Exposes a provider-compatible object schema while enforcing action-specific inputs locally.
 */
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import type { Static } from 'typebox';

const command = Type.String({ minLength: 1, maxLength: 32768, description: 'Required for start.' });
const label = Type.String({ minLength: 1, maxLength: 160 });
const requestId = Type.String({ minLength: 1, maxLength: 128 });
const taskId = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  description: 'Required for status, logs, wait and stop. Use the taskId returned by start.',
});
const cursor = Type.Integer({ minimum: 0 });
const limitBytes = Type.Integer({ minimum: 1, maximum: 65536 });
const timeoutMs = Type.Integer({ minimum: 1, maximum: 30000 });

// Providers require an object at the root. Conditional required fields are checked before execution.
export const backgroundTaskSchema = Type.Object(
  {
    action: Type.String({ enum: ['start', 'list', 'status', 'logs', 'wait', 'stop'] }),
    command: Type.Optional(command),
    label: Type.Optional(label),
    requestId: Type.Optional(requestId),
    taskId: Type.Optional(taskId),
    cursor: Type.Optional(cursor),
    limitBytes: Type.Optional(limitBytes),
    timeoutMs: Type.Optional(timeoutMs),
  },
  { additionalProperties: false }
);

const actionSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal('start'),
      command,
      label: Type.Optional(label),
      requestId: Type.Optional(requestId),
    },
    { additionalProperties: false }
  ),
  Type.Object({ action: Type.Literal('list') }, { additionalProperties: false }),
  Type.Object(
    { action: Type.Union([Type.Literal('status'), Type.Literal('stop')]), taskId },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      action: Type.Literal('logs'),
      taskId,
      cursor: Type.Optional(cursor),
      limitBytes: Type.Optional(limitBytes),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    { action: Type.Literal('wait'), taskId, timeoutMs: Type.Optional(timeoutMs) },
    { additionalProperties: false }
  ),
]);

/**
 * Rejects missing, unrelated or invalid fields before any process operation can run.
 */
export function parseBackgroundTaskInput(value: unknown): Static<typeof actionSchema> {
  if (!Check(actionSchema, value)) {
    throw new Error(
      'INVALID_ARGUMENT: start requires command; status/logs/wait/stop require taskId. Only pass fields for the selected action.'
    );
  }
  return value;
}
