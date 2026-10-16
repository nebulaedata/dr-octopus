/**
 * @author Codex
 * @description Validates the finite Basic tool inputs without granting task or device authority.
 */
import { z } from 'zod';

const taskId = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value);
const path = z.string().min(1).max(4096);
const version = z.string().min(1).max(256);
const idempotencyKey = z.string().min(1).max(128);

export const readInputSchema = z
  .strictObject({
    taskId,
    path,
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
    expectedVersion: version.optional(),
    byteOffset: z
      .number()
      .int()
      .min(0)
      .max(64 * 1024 * 1024)
      .optional(),
    byteLimit: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024)
      .optional(),
  })
  .refine(
    (input) =>
      !(
        (input.offset !== undefined || input.limit !== undefined) &&
        (input.byteOffset !== undefined || input.byteLimit !== undefined)
      ),
    { message: 'Line and byte paging cannot be combined.' }
  );

export const writeInputSchema = z.strictObject({
  taskId,
  path,
  content: z
    .string()
    .max(8 * 1024 * 1024)
    .refine(
      (value) => value.isWellFormed() && !value.includes('\0') && Buffer.byteLength(value) <= 8 * 1024 * 1024
    ),
  idempotencyKey,
  expectedVersion: version.optional(),
});

export const editInputSchema = z.strictObject({
  taskId,
  path,
  edits: z
    .array(
      z.strictObject({
        oldText: z
          .string()
          .min(1)
          .max(16 * 1024 * 1024),
        newText: z.string().max(8 * 1024 * 1024),
      })
    )
    .min(1)
    .max(100)
    .refine(
      (edits) =>
        edits.every(
          ({ oldText, newText }) =>
            oldText.isWellFormed() && newText.isWellFormed() && !newText.includes('\0')
        ) &&
        edits.reduce(
          (bytes, edit) => bytes + Buffer.byteLength(edit.oldText) + Buffer.byteLength(edit.newText),
          0
        ) <=
          8 * 1024 * 1024
    ),
  idempotencyKey,
  expectedVersion: version.optional(),
});

export const shellInputSchema = z.strictObject({
  taskId,
  command: z
    .string()
    .min(1)
    .max(16 * 1024)
    .refine(
      (value) => value.isWellFormed() && !value.includes('\0') && Buffer.byteLength(value) <= 16 * 1024
    ),
  idempotencyKey,
  timeout: z.number().int().min(1).max(600).default(120),
});

export type ReadInput = z.infer<typeof readInputSchema>;
export type EditInput = z.infer<typeof editInputSchema>;

export class BasicToolError extends Error {
  /**
   * Carries a stable public code and safe message; file contents and internal paths are excluded.
   */
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'BasicToolError';
  }
}
