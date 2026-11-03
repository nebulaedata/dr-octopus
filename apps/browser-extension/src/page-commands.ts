/**
 * @author Codex
 * @description Separates genuine local-run page ownership from Native connection identity while sharing finite Browser parameter schemas.
 */
import { z } from 'zod';
import { browserParams, browserRequestSchema } from '@octopus/shared/protocol/browser-tools';
import { browserSkillChoiceSchema } from '@octopus/shared/protocol/browser-skills';

const local = {
  type: z.literal('request'),
  requestId: z.uuid(),
  localRunId: z.uuid(),
  taskId: z.uuid(),
  choiceRequirements: z.array(browserSkillChoiceSchema).max(100).optional(),
};
export const applyChoiceParams = z.strictObject({
  tabId: z.number().int().nonnegative(),
  requirementId: z.string().regex(/^choice-action-[1-9]\d{0,4}$/),
});
export const localPageRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({
    ...local,
    method: z.literal('apply_choice'),
    params: applyChoiceParams.extend({
      documentId: z.string().min(1).max(128),
      controllerId: z.uuid(),
      snapshotId: z.uuid(),
    }),
  }),
  z.strictObject({ ...local, method: z.literal('browser_tabs'), params: browserParams.browser_tabs }),
  z.strictObject({ ...local, method: z.literal('browser_open_tab'), params: browserParams.browser_open_tab }),
  z.strictObject({ ...local, method: z.literal('browser_navigate'), params: browserParams.browser_navigate }),
  z.strictObject({
    ...local,
    method: z.literal('browser_close_tab'),
    params: browserParams.browser_close_tab,
  }),
  z.strictObject({ ...local, method: z.literal('browser_snapshot'), params: browserParams.browser_snapshot }),
  z.strictObject({
    ...local,
    method: z.literal('browser_read_snapshot'),
    params: browserParams.browser_read_snapshot,
  }),
  z.strictObject({ ...local, method: z.literal('browser_click'), params: browserParams.browser_click }),
  z.strictObject({ ...local, method: z.literal('browser_fill'), params: browserParams.browser_fill }),
  z.strictObject({ ...local, method: z.literal('browser_select'), params: browserParams.browser_select }),
  z.strictObject({ ...local, method: z.literal('browser_scroll'), params: browserParams.browser_scroll }),
]);
export const pageRequestSchema = z.union([browserRequestSchema, localPageRequestSchema]);
export const pageOwnerSchema = z.union([
  z.strictObject({ connectionId: z.uuid() }),
  z.strictObject({ localRunId: z.uuid() }),
]);
export type PageOwner = z.infer<typeof pageOwnerSchema>;
export type LocalPageRequest = z.infer<typeof localPageRequestSchema>;

/**
 * Projects owner identity without inventing a Native connection for a local task.
 */
export function pageOwner(request: z.infer<typeof pageRequestSchema>): PageOwner {
  return 'localRunId' in request
    ? { localRunId: request.localRunId }
    : { connectionId: request.connectionId };
}

/**
 * Namespaces the two authorities so coincidental UUID equality never grants ownership.
 */
export function pageOwnerKey(owner: PageOwner): string {
  return 'localRunId' in owner ? 'local:' + owner.localRunId : 'native:' + owner.connectionId;
}
