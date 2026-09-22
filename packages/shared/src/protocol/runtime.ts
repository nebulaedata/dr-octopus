/**
 * @author Codex
 * @description Defines shared runtime controls, model metadata, commands, and advertised Host capabilities.
 */
import type { KnowledgeModeState } from './knowledge/mode.js';

export const OCTOPUS_PROTOCOL_VERSION = 5 as const;

export type RuntimeProjectionState =
  'dormant' | 'starting' | 'idle' | 'running' | 'recovering' | 'stopping' | 'failed';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const PERMISSION_MODES = ['ask', 'auto', 'full'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface PermissionStateDto {
  mode: PermissionMode;
  scope: 'runtime-generation';
  persisted: false;
}

export const RUNTIME_WORK_MODES = ['agent', 'plan', 'knowledge'] as const;
export type RuntimeWorkMode = (typeof RUNTIME_WORK_MODES)[number];
export type PlanModePhase = 'off' | 'planning' | 'ready' | 'saved' | 'implementing';

export interface PlanModeStateDto {
  knowledge?: KnowledgeModeState;
  available: boolean;
  workMode: RuntimeWorkMode;
  phase: PlanModePhase;
  awaitingAction: boolean;
}

/**
 * Narrows untrusted control-plane values to supported permission modes.
 *
 * @param value Unknown value crossing an application boundary.
 * @returns Whether the value is a supported permission mode.
 */
export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.some((mode) => mode === value);
}

/**
 * Narrows untrusted protocol and persistence values to Pi thinking-level identifiers.
 *
 * @param value Unknown value crossing an application boundary.
 * @returns Whether the value belongs to the current Pi thinking-level contract.
 */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level === value);
}

export interface ThinkingStateDto {
  level: ThinkingLevel;
  availableLevels: ThinkingLevel[];
}

export interface ContextUsageDto {
  /** Estimated tokens currently retained in the model context; null immediately after compaction. */
  tokens: number | null;
  contextWindow: number;
  /** Percentage reported by Pi; null when no reliable token estimate exists yet. */
  percent: number | null;
}

export interface ModelDto {
  thinkingLevels?: ThinkingLevel[];
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow?: number;
}

export type CommandSource = 'host' | 'extension' | 'prompt' | 'skill';
export type CommandExecution = 'prompt' | 'realtime' | 'http' | 'client';

export interface CommandDto {
  name: string;
  description?: string;
  source: CommandSource;
  execution: CommandExecution;
  enabled: boolean;
  disabledReason?: string;
}

export interface CommandCatalogDto {
  commands: CommandDto[];
}

export interface OctopusCapabilities {
  protocolVersion: typeof OCTOPUS_PROTOCOL_VERSION;
  features: {
    attachments: boolean;
    commands: boolean;
    compaction: boolean;
    extensionUi: boolean;
    models: boolean;
    sessionDerivation: boolean;
    sessionTree: boolean;
    workModes: boolean;
    shell: false;
  };
  limits: {
    maxAttachmentBytes: number;
    maxAttachmentsPerMessage: number;
    maxAttachmentMessageBytes: number;
    tusChunkBytes: number;
    maxPromptCharacters: number;
    maxSubscriptionsPerConnection: number;
    maxWebSocketMessageBytes: number;
  };
}
