/**
 * @author Codex
 * @description Defines redacted environment Settings snapshots and revision-checked patch requests.
 */
import { z } from 'zod';

export const EnvironmentScopeSchema = z.enum(['server', 'agent']);
export type EnvironmentScope = z.infer<typeof EnvironmentScopeSchema>;

export const UpdateEnvironmentBodySchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    changes: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), z.string().max(8192).nullable())
      .refine((values) => Object.keys(values).length > 0 && Object.keys(values).length <= 256),
  })
  .strict();
export type UpdateEnvironmentBody = z.infer<typeof UpdateEnvironmentBodySchema>;

export interface EnvironmentEntryDto {
  key: string;
  source: 'override' | 'process' | 'dotenv' | 'file' | 'default';
  hasStoredValue: boolean;
  sensitive: boolean;
  storedValue?: string;
  resolvedValue?: string;
}

export interface EnvironmentSettingsDto {
  scope: EnvironmentScope;
  path: string;
  revision: string;
  entries: EnvironmentEntryDto[];
}
