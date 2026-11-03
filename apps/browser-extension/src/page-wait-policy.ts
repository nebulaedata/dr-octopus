/**
 * @author Codex
 * @description Defines bounded user-owned page readiness waits and matching host lifetime budgets.
 */
import { z } from 'zod';

export const pageWaitDefaults = { seconds: 15, attempts: 3 };
export const pageWaitPolicySchema = z.strictObject({
  seconds: z.number().int().min(1).max(60),
  attempts: z.number().int().min(1).max(5),
});
export type PageWaitPolicy = z.infer<typeof pageWaitPolicySchema>;
export type PageWaitProgress = PageWaitPolicy & { attempt: number; tabId: number; startedAt: number };
/**
 * Observes actual wait-window transitions without creating a model tool invocation.
 */
export type PageWaitObserver = (progress: PageWaitProgress) => Promise<void>;

/**
 * Leaves the ordinary model/IPC allowance in addition to the complete configured wait sequence.
 */
export function pageWaitStepTimeout(policy?: PageWaitPolicy): number {
  const value = pageWaitPolicySchema.parse(policy ?? pageWaitDefaults);
  return 60000 + value.seconds * value.attempts * 1000 + 5000;
}
