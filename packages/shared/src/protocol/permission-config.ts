/**
 * @author Codex
 * @description Defines the versioned permission configuration contract shared by Agent, Settings API and editors.
 */
import { z } from 'zod';

export const PermissionActionSchema = z.enum(['allow', 'ask', 'deny']);
export const PermissionKindSchema = z.enum(['read', 'write', 'shell', 'custom']);
const key = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value) && !/\s/u.test(value));
const field = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/u)
  .refine((value) =>
    value.split('.').every((part) => !['__proto__', 'prototype', 'constructor'].includes(part))
  );
const fields = z.array(field).max(16);
const actions = z.record(key, PermissionActionSchema);
const kinds = z
  .object({
    read: PermissionActionSchema.optional(),
    write: PermissionActionSchema.optional(),
    shell: PermissionActionSchema.optional(),
    custom: PermissionActionSchema.optional(),
  })
  .strict();
const mode = z
  .object({ tools: actions.optional(), kinds: kinds.optional(), external: PermissionActionSchema.optional() })
  .strict();

export const PermissionToolRuleSchema = z
  .object({
    kind: PermissionKindSchema,
    pathFields: fields.optional(),
    commandFields: fields.optional(),
    sessionApproval: z
      .object({
        fields: fields,
        fieldDefaults: z.record(field, z.string().max(200)).optional(),
        pathParents: fields.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PermissionConfigSchema = z
  .object({
    version: z.literal(2).optional(),
    toolRules: z.record(key, PermissionToolRuleSchema.nullable()).optional(),
    requestDefaults: z
      .object({ pathFields: fields.optional(), commandFields: fields.optional() })
      .strict()
      .optional(),
    policy: z.object({ tools: actions.optional() }).strict().optional(),
    modes: z
      .object({ ask: mode.optional(), auto: mode.optional(), full: mode.optional() })
      .strict()
      .optional(),
    permissionReviewLog: z.boolean().optional(),
    reviewLogFieldMaxWidth: z.number().int().min(1).max(100000).optional(),
  })
  .strict();

export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;
export type PermissionToolRule = z.infer<typeof PermissionToolRuleSchema>;
export type PermissionConfigAction = z.infer<typeof PermissionActionSchema>;
export type PermissionConfigKind = z.infer<typeof PermissionKindSchema>;
export interface PermissionResolvedConfig {
  version: 2;
  toolRules: Record<string, PermissionToolRule>;
  requestDefaults: { pathFields: string[]; commandFields: string[] };
  policy: { tools: Record<string, PermissionConfigAction> };
  modes: Record<
    'ask' | 'auto' | 'full',
    {
      tools: Record<string, PermissionConfigAction>;
      kinds: Record<PermissionConfigKind, PermissionConfigAction>;
      external: PermissionConfigAction;
    }
  >;
  permissionReviewLog: boolean;
  reviewLogFieldMaxWidth: number;
}
export interface PermissionSettingsSnapshot {
  path: string;
  revision: string;
  raw: string;
  overrides: PermissionConfig | null;
  inherited: PermissionResolvedConfig | null;
  effective: PermissionResolvedConfig | null;
  diagnostics: { path: string; message: string }[];
}
export const PermissionSettingsUpdateSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    config: PermissionConfigSchema,
  })
  .strict();
export type PermissionSettingsUpdate = z.infer<typeof PermissionSettingsUpdateSchema>;
