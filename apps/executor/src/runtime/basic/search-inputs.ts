/**
 * @author Codex
 * @description Defines finite readonly search inputs without allowing callers to select processes or grants.
 */
import { z } from 'zod';
const text = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.isWellFormed() && !value.includes('\0'));
const common = {
  taskId: z.string().min(1).max(128),
  path: text.default('.'),
  limit: z.number().int().min(1).max(1000).default(1000),
  hidden: z.boolean().default(false),
};
export const lsInputSchema = z.strictObject(common);
export const findInputSchema = z.strictObject({
  ...common,
  pattern: text,
  ignore: z.boolean().default(true),
});
export const grepInputSchema = z.strictObject({
  ...common,
  pattern: text,
  glob: text.optional(),
  literal: z.boolean().default(false),
  ignoreCase: z.boolean().default(false),
  context: z.number().int().min(0).max(5).default(0),
  ignore: z.boolean().default(true),
});
export type LsInput = z.infer<typeof lsInputSchema>;
export type FindInput = z.infer<typeof findInputSchema>;
export type GrepInput = z.infer<typeof grepInputSchema>;
