/**
 * @author Codex
 * @description Defines the shared Goal state projection protocol.
 */

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'usage_limited' | 'budget_limited';

export interface GoalWaitDto {
  reason: string;
  resumeAt?: number;
}

export interface GoalStateDto {
  id: string;
  objective: string;
  status: GoalStatus;
  startedAt: number;
  updatedAt: number;
  iteration: number;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  automaticModelTurns: number;
  safetyPauseCause?: 'continuation_limit' | 'no_progress';
  waiting?: GoalWaitDto;
}
