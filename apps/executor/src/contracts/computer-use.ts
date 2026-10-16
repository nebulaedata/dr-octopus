/**
 * @author Codex
 * @description Defines truthful Computer task and in-flight feedback without granting desktop capabilities or claiming input ownership.
 */
import { z } from 'zod';

export const computerRuntimeStatusSchema = z
  .strictObject({
    state: z.enum(['stopped', 'starting', 'ready', 'failed', 'unavailable', 'stopping', 'closed']),
    available: z.boolean(),
    reason: z.string().max(200),
  })
  .refine((value) => value.available === (value.state === 'ready'));
export type ComputerRuntimeStatus = z.infer<typeof computerRuntimeStatusSchema>;

export const computerUseSchema = z
  .strictObject({
    revision: z.number().int().nonnegative(),
    activityId: z.uuid().nullable(),
    state: z.enum(['idle', 'running', 'unknown']),
    activeCalls: z.number().int().min(0).max(32),
    activeTasks: z.number().int().min(0).max(32).default(0),
  })
  .refine((value) => {
    if (value.state === 'idle') {
      return value.activeCalls + value.activeTasks === 0 && value.activityId === null;
    }
    return value.activeCalls + value.activeTasks > 0 && value.activityId !== null;
  });
export type ComputerUseSnapshot = z.infer<typeof computerUseSchema>;
export const computerUseMessageSchema = z.strictObject({
  type: z.literal('computer-use'),
  pid: z.number().int().positive(),
  activity: computerUseSchema,
});
export const computerStopMessageSchema = z.strictObject({
  type: z.literal('computer-stop'),
  activityId: z.uuid(),
});
export const computerIndicatorReplySchema = z.strictObject({
  type: z.literal('computer-indicator-reply'),
  revision: z.number().int().positive(),
  visible: z.boolean(),
});
