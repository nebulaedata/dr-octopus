/**
 * @author Codex
 * @description Defines the managed Session runtime contracts, identities, lifecycle state, and capacity defaults.
 */

import type { RpcCommand } from '@earendil-works/pi-coding-agent';
import type { WorkspaceDescriptor } from '@octopus/agent';

export type SessionRuntimeState = 'starting' | 'idle' | 'running' | 'recovering' | 'stopping' | 'failed';

export type SessionRuntimeErrorCode =
  | 'SESSION_LOOKUP_UNAVAILABLE'
  | 'SESSION_METADATA_INVALID'
  | 'SESSION_WORKSPACE_MISMATCH'
  | 'SESSION_RUNTIME_CAPACITY'
  | 'SESSION_RUNTIME_QUEUE_FULL'
  | 'SESSION_RUNTIME_CANCELLED'
  | 'SESSION_RUNTIME_TIMEOUT'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_RUNTIME_STALE'
  | 'SESSION_PIN_LIMIT'
  | 'SESSION_RUNTIME_BINDING_MISMATCH'
  | 'SESSION_EXTENSION_UI_NOT_FOUND'
  | 'SESSION_REPLACEMENT_FORBIDDEN';

export type ManagedSessionCommand = Exclude<
  RpcCommand,
  { type: 'switch_session' | 'new_session' | 'fork' | 'clone' }
>;

export interface SessionRuntimeBinding {
  runtimeId: string;
  epoch: number;
  workspaceId: string;
  workspaceCwd: string;
  agentSessionId: string;
  sessionId: string;
  sessionPath: string;
  state: SessionRuntimeState;
  lastActiveAt: number;
}

export interface HostAgentEvent {
  type: 'agent-event' | 'runtime-state' | 'extension-ui' | 'error';
  runtimeId: string;
  epoch: number;
  workspaceId: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  payload: unknown;
}

export interface SessionRuntimeRequestOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
}

export interface SessionRuntimeSlotSnapshot {
  sessionId: string;
  canonicalSessionPath?: string;
  state: 'empty' | 'activating' | 'active' | 'draining';
  demandCount: number;
  epoch: number;
  runtimeId?: string;
}

export interface SessionRuntimeDiagnostics {
  activeRuntimeCount: number;
  admissionQueueDepth: number;
  slotCount: number;
  slotStates: Record<SessionRuntimeSlotSnapshot['state'], number>;
  slots: SessionRuntimeSlotSnapshot[];
}

export interface SessionRuntimeLimits {
  maxActiveRuntimes: number;
  maxActiveRuntimesPerWorkspace: number;
  idleTtlMs: number;
}

export interface ActivateExistingSessionInput {
  workspace: WorkspaceDescriptor;
  sessionId: string;
  sessionPath: string;
  expectedAgentSessionId: string;
}

export interface ActivateNewSessionInput {
  workspace: WorkspaceDescriptor;
  sessionId: string;
}

export const DEFAULT_SESSION_RUNTIME_LIMITS: SessionRuntimeLimits = {
  maxActiveRuntimes: 9,
  maxActiveRuntimesPerWorkspace: 5,
  idleTtlMs: 15 * 60_000,
};
