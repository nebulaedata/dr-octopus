/**
 * @author Codex
 * @description Defines runtime-independent first-message submission and durable operation status.
 */
import { z } from 'zod';
import { THINKING_LEVELS, PERMISSION_MODES, RUNTIME_WORK_MODES } from './runtime.js';
import { parseKnowledgeModeConfig } from './knowledge/mode.js';
import { WorkspaceReferencesSchema } from './workspace-references.js';

export const ModelSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('follow-default') }),
  z.object({ mode: z.literal('explicit'), provider: z.string().min(1), modelId: z.string().min(1) }),
]);
export const DraftControlsSchema = z.object({
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
  workMode: z.enum(RUNTIME_WORK_MODES).optional(),
  knowledge: z
    .unknown()
    .transform((value, context) => {
      try {
        return parseKnowledgeModeConfig(value);
      } catch {
        context.addIssue({ code: 'custom', message: 'Invalid knowledge collection scope.' });
        return z.NEVER;
      }
    })
    .optional(),
});
export type DraftControls = z.infer<typeof DraftControlsSchema>;
export const ConversationStartSchema = z.object({
  submissionId: z.string().uuid(),
  draftId: z.string().uuid(),
  draftVersion: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(200000),
  attachmentIds: z.array(z.string()).max(100).default([]),
  workspaceReferences: WorkspaceReferencesSchema.default([]),
  selection: ModelSelectionSchema,
  controls: DraftControlsSchema.optional(),
});
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export type ConversationStartInput = z.infer<typeof ConversationStartSchema>;
export type ConversationStartStatus =
  'preparing' | 'accepted' | 'dispatching' | 'running' | 'failed' | 'unknown' | 'cancelled';
export interface ConversationStartDto {
  submissionId: string;
  sessionId: string;
  status: ConversationStartStatus;
  error?: string;
  message: string;
  /**
   * Restores an unaccepted submission after tab storage loss; never permits replay of accepted work.
   */
  draft?: ConversationStartInput;
}
