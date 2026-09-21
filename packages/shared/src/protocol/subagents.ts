/**
 * @author Codex
 * @description Defines the shared subagent fleet snapshot protocol.
 */

export type SubagentFleetNodeState =
  'queued' | 'running' | 'complete' | 'failed' | 'partial' | 'paused' | 'stopped' | 'rejected';

export interface SubagentFleetActivityDto {
  state?: string;
  currentTool?: string;
  lastActivityAt?: number;
  currentToolStartedAt?: number;
  turnCount?: number;
  toolCount?: number;
}

export interface SubagentFleetNodeDto {
  id: string;
  kind: 'subagent' | 'workflow' | 'step' | 'host-step';
  label: string;
  state: SubagentFleetNodeState;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  activity?: SubagentFleetActivityDto;
  children?: SubagentFleetNodeDto[];
}

export interface SubagentFleetSnapshotDto {
  kind: 'pi-subagents.async-status-snapshot';
  version: 1;
  generatedAt: number;
  omitted: {
    runs: number;
    children: number;
    byteLimitExceeded: boolean;
  };
  runs: SubagentFleetNodeDto[];
}
