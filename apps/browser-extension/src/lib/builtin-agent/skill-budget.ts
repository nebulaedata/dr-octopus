/**
 * @author Codex
 * @description Defines user-owned model request limits shared by settings, Worker admission and session UI.
 */
import { z } from 'zod';
import { pageWaitDefaults, pageWaitPolicySchema } from '../../page-wait-policy';
export const skillBudgetMaximum = 500;
export const skillBudgetDefaults = {
  organize: 50,
  replay: 100,
  pageWaitSeconds: pageWaitDefaults.seconds,
  pageWaitAttempts: pageWaitDefaults.attempts,
};
export const skillBudgetSchema = z.strictObject({
  organize: z.number().int().min(1).max(skillBudgetMaximum),
  replay: z.number().int().min(1).max(skillBudgetMaximum),
  pageWaitSeconds: pageWaitPolicySchema.shape.seconds.default(pageWaitDefaults.seconds),
  pageWaitAttempts: pageWaitPolicySchema.shape.attempts.default(pageWaitDefaults.attempts),
});
export type SkillBudget = z.infer<typeof skillBudgetSchema>;

/** Resolves a persisted task budget; existing task snapshots remain fixed across settings changes. */
export function skillModelLimit(session: {
  mode: 'organize' | 'replay';
  modelCallLimit?: number;
  context?: { skill?: { candidate: { workflow: { execution: { maxModelCalls: number } } } } };
}): number {
  if (session.modelCallLimit !== undefined) {
    return session.modelCallLimit;
  }
  // Preserve the budget of tasks created before configurable limits until the user explicitly extends it.
  return session.mode === 'organize'
    ? 12
    : Math.min(20, session.context?.skill?.candidate.workflow.execution.maxModelCalls ?? 20);
}
