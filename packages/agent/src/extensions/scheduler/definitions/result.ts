/**
 * @author Codex
 * @description Defines trusted Host access to settled execution identity without exposing paths to model tools.
 */
import type { ScheduledRun } from '@octopus/shared/protocol/scheduled-tasks';
export interface SchedulerResult {
  run: ScheduledRun;
  taskName: string;
  workspaceId: string;
  originSessionRef: string | null;
  cwd: string;
  prompt: string;
  session: { id: string; path: string } | null;
  artifactError?: string;
}
