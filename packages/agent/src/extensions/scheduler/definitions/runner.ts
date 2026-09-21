/**
 * @author Codex
 * @description Narrow execution and dispatch callbacks for one isolated Scheduler Run Session.
 */
import type { SchedulerExecutionWork, SchedulerRunOutcome, SchedulerSessionEvidence } from './work.js';

export interface SchedulerRunCallbacks {
  /**
   * Persist Session identity and the dispatch barrier before sending the prompt.
   */
  dispatch(evidence: SchedulerSessionEvidence): boolean;
  /**
   * Persist the exact prompt entry evidence after Pi accepts the prompt.
   */
  running(promptEntryId: string): boolean;
}

export interface SchedulerRunner {
  /**
   * Execute one claimed snapshot until a single terminal outcome is known.
   */
  run(
    work: SchedulerExecutionWork,
    signal: AbortSignal,
    callbacks: SchedulerRunCallbacks
  ): Promise<SchedulerRunOutcome>;
}
