/**
 * @author Codex
 * @description Defines runtime-validated Workspace references selected through the Agent Composer.
 */

import { z } from 'zod';

export const MAX_WORKSPACE_REFERENCES = 32;
export const MAX_WORKSPACE_REFERENCE_PATH_LENGTH = 1024;

export const WorkspaceReferenceSchema = z
  .object({
    path: z.string().min(1).max(MAX_WORKSPACE_REFERENCE_PATH_LENGTH),
    kind: z.enum(['file', 'directory']),
  })
  .strict();

export const WorkspaceReferencesSchema = z.array(WorkspaceReferenceSchema).max(MAX_WORKSPACE_REFERENCES);

export type WorkspaceReferenceDto = z.infer<typeof WorkspaceReferenceSchema>;
