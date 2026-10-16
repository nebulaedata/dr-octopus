/**
 * @author Codex
 * @description Defines product task tools independently of MCP native task extensions and authorization grants.
 */
import { z } from 'zod';
import { executorPermissionSchema } from '../../contracts/access';
const key = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value);
export const taskStartSchema = z.strictObject({
  capabilities: z
    .array(executorPermissionSchema)
    .min(1)
    .max(6)
    .refine((values) => new Set(values).size === values.length),
  idempotencyKey: key,
  connectionId: z.uuid().optional(),
  cwd: z.string().min(1).max(4096).default('.'),
});
export const taskIdSchema = z.strictObject({ taskId: z.uuid() });
export const taskStatusSchema = z.union([
  z.strictObject({}),
  z.strictObject({ creationKey: key }),
  z.strictObject({ taskId: z.uuid(), operationKey: key.optional() }),
]);
