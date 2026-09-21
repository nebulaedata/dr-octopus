/**
 * @author Codex
 * @description Defines strict scheduled-task transport contracts without runtime identity in mutation inputs.
 */
import { z } from 'zod';
import { taskAuthorizationRefSchema } from './authorization.js';
export * from './authorization.js';

export const scheduleSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('once'), at: z.iso.datetime({ offset: true }) }),
  z.strictObject({
    type: z.literal('cron'),
    expression: z.string().trim().min(9).max(256),
    timezone: z.string().min(1).max(100),
  }),
  z.strictObject({
    type: z.literal('interval'),
    everyMs: z.number().int().min(60_000).max(31_536_000_000),
    anchorAt: z.iso.datetime({ offset: true }),
  }),
]);
const scheduledTaskFieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  prompt: z.string().trim().min(1).max(100_000),
  schedule: scheduleSchema,
  enabled: z.boolean(),
  misfirePolicy: z.enum(['skip', 'coalesce']),
  overlapPolicy: z.enum(['skip', 'queue-one']),
  timeoutMs: z.number().int().min(1000).max(86_400_000),
});
export const scheduledTaskInputSchema = scheduledTaskFieldsSchema.extend({
  description: scheduledTaskFieldsSchema.shape.description.default(''),
  enabled: scheduledTaskFieldsSchema.shape.enabled.default(true),
  misfirePolicy: scheduledTaskFieldsSchema.shape.misfirePolicy.default('coalesce'),
  overlapPolicy: scheduledTaskFieldsSchema.shape.overlapPolicy.default('queue-one'),
  timeoutMs: scheduledTaskFieldsSchema.shape.timeoutMs.default(1_800_000),
});
export const scheduledTaskPatchSchema = scheduledTaskFieldsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const scheduledTaskSchema = scheduledTaskFieldsSchema.extend({
  id: z.string(),
  workspaceId: z.string(),
  targetSessionId: z.string().nullable(),
  executionMode: z.literal('isolated-run'),
  hasActiveRun: z.boolean().optional(),
  authorizationRef: taskAuthorizationRefSchema.nullable(),
  authorizationBlock: z.string().nullable(),
  revision: z.number().int().positive(),
  nextRunAt: z.iso.datetime().nullable(),
  pausedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const scheduledRunStatusSchema = z.enum([
  'queued',
  'claimed',
  'dispatching',
  'running',
  'succeeded',
  'failed',
  'needs_attention',
  'timed_out',
  'cancelled',
  'interrupted',
  'skipped',
]);
export const scheduledRunSchema = z.strictObject({
  id: z.string(),
  taskId: z.string(),
  scheduledFor: z.iso.datetime(),
  triggerSource: z.enum(['schedule', 'manual']),
  status: scheduledRunStatusSchema,
  cancelRequestedAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),
  settledAt: z.iso.datetime().nullable(),
  summary: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const scheduledMutationSchema = z.strictObject({
  task: scheduledTaskSchema,
  run: scheduledRunSchema.optional(),
  warnings: z.array(z.string()),
  effect: z.enum(['saved', 'queued', 'cancelled', 'cancellation_requested', 'deleted', 'restored', 'purged']),
});
export const scheduledPaginationSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export const scheduledTaskQuerySchema = scheduledPaginationSchema.extend({
  status: z.enum(['all', 'pending', 'completed', 'paused', 'attention', 'archived']).default('all'),
  q: z.string().trim().max(200).default(''),
});
export const scheduledHistoryQuerySchema = scheduledPaginationSchema
  .extend({
    status: scheduledRunStatusSchema.optional(),
    q: z.string().trim().max(200).default(''),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
    message: 'Start time must not exceed end time',
  });
export type ScheduledTaskQuery = z.infer<typeof scheduledTaskQuerySchema>;
export type ScheduledHistoryQuery = z.infer<typeof scheduledHistoryQuerySchema>;
export type ScheduledHistoryRun = ScheduledRun & { taskName?: string; archived?: boolean };
export const scheduledCancelSchema = z.strictObject({ runId: z.string().min(1).max(100) });
export const scheduledEmptySchema = z.strictObject({});
export type Schedule = z.infer<typeof scheduleSchema>;
export type ScheduledTaskInput = z.infer<typeof scheduledTaskInputSchema>;
export type ScheduledTaskPatch = z.infer<typeof scheduledTaskPatchSchema>;
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;
export type ScheduledRun = z.infer<typeof scheduledRunSchema>;
export type ScheduledMutation = z.infer<typeof scheduledMutationSchema>;
export type ScheduledPagination = z.infer<typeof scheduledPaginationSchema>;
