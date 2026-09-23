/**
 * @author Codex
 * @description Executes Session-scoped managed-runtime commands and reports successful mutations through callbacks.
 */

import { stopSession } from './stop-session.js';
import { SessionRuntimeError } from './errors.js';
import { hasPlanModeCommand } from './plan-mode-state-projection.js';
import { responseData, responseSucceeded } from './utils.js';
import { isThinkingLevel } from '@octopus/shared/protocol';
import type { KnowledgeModeConfig } from '@octopus/shared/protocol/knowledge';
import type { SessionRuntimeOperation } from './operation.js';
import type { ManagedSessionCommand } from './types.js';
import type { RpcExtensionUIResponse } from '@earendil-works/pi-coding-agent';
import type { BackgroundTasksSnapshot } from '@octopus/shared/protocol';
import type {
  SubagentFleetSnapshotDto,
  PermissionMode,
  PermissionStateDto,
  PlanModeStateDto,
  RuntimeWorkMode,
  ThinkingLevel,
  ThinkingStateDto,
} from '@octopus/shared/protocol';

type CommandOf<TType extends ManagedSessionCommand['type']> = Extract<ManagedSessionCommand, { type: TType }>;

export interface RuntimePreferenceUpdate {
  thinkingLevel?: ThinkingLevel;
  steeringMode?: CommandOf<'set_steering_mode'>['mode'];
  followUpMode?: CommandOf<'set_follow_up_mode'>['mode'];
  autoCompactionEnabled?: CommandOf<'set_auto_compaction'>['enabled'];
  autoRetryEnabled?: CommandOf<'set_auto_retry'>['enabled'];
}

export interface RuntimeGenerationTarget {
  runtimeId?: string;
  epoch?: number;
}

export interface RuntimeCommandsOptions {
  /**
   * Reads the session-owned detached task projection for stop confirmation.
   */
  readSubagentFleet?: (sessionId: string) => SubagentFleetSnapshotDto | undefined;
  /**
   * Reads complete process ownership evidence for background stop verification.
   */
  readBackgroundTasks?: (sessionId: string) => BackgroundTasksSnapshot | null | undefined;
  /**
   * Acquires one runtime generation for the complete command operation.
   */
  withRuntime: <T>(
    sessionId: string,
    operation: (target: SessionRuntimeOperation) => Promise<T>
  ) => Promise<T>;
  /**
   * Runs after Pi accepts a command and before the completion callback.
   */
  onCommandSucceeded?: (sessionId: string, command: ManagedSessionCommand, timestamp: string) => void;
  /**
   * Runs after a command response resolves, including unsuccessful Pi response envelopes.
   */
  onCommandCompleted?: (sessionId: string) => void;
  /**
   * Supplies timestamps for successful-command projection and defaults to the system clock.
   */
  now?: () => Date;
  /**
   * Reads the current branch-backed Plan state after the runtime command catalog has been validated.
   */
  readPlanModeState?: (sessionId: string, available: boolean) => PlanModeStateDto;
}

/**
 * Concentrates command ordering, exact runtime targeting, and successful-command notification.
 */
export class RuntimeCommands {
  readonly #stops = new Map<string, Promise<unknown>>();
  readonly #blocked = new Map<string, string>();
  readonly #readBackgroundTasks: RuntimeCommandsOptions['readBackgroundTasks'];
  readonly #readSubagentFleet: NonNullable<RuntimeCommandsOptions['readSubagentFleet']>;
  readonly #withRuntime: RuntimeCommandsOptions['withRuntime'];
  readonly #onCommandSucceeded: NonNullable<RuntimeCommandsOptions['onCommandSucceeded']>;
  readonly #onCommandCompleted: NonNullable<RuntimeCommandsOptions['onCommandCompleted']>;
  readonly #now: NonNullable<RuntimeCommandsOptions['now']>;
  readonly #readPlanModeState: NonNullable<RuntimeCommandsOptions['readPlanModeState']>;

  /**
   * Creates Session command orchestration with optional application projection callbacks.
   */
  public constructor(options: RuntimeCommandsOptions) {
    this.#withRuntime = (sessionId, operation) => options.withRuntime(sessionId, operation);
    this.#onCommandSucceeded = options.onCommandSucceeded ?? (() => undefined);
    this.#onCommandCompleted = options.onCommandCompleted ?? (() => undefined);
    this.#readSubagentFleet = options.readSubagentFleet ?? (() => undefined);
    this.#readBackgroundTasks = options.readBackgroundTasks;
    this.#now = options.now ?? (() => new Date());
    this.#readPlanModeState =
      options.readPlanModeState ??
      (() => ({ available: false, workMode: 'agent', phase: 'off', awaitingAction: false }));
  }

  /**
   * Executes an allowed command and projects successful mutable Session metadata.
   */
  public async execute(
    sessionId: string,
    command: ManagedSessionCommand,
    expected: RuntimeGenerationTarget = {}
  ): Promise<unknown> {
    return this.#withRuntime(sessionId, async (target) => {
      this.#assertTarget(target, expected);
      const generationKey = `${target.binding.runtimeId}:${String(target.epoch)}`;
      if (
        this.#blocked.get(sessionId) === generationKey &&
        ['prompt', 'steer', 'follow_up'].includes(command.type)
      ) {
        throw new SessionRuntimeError(
          'SESSION_RUNTIME_STALE',
          'Stop is not confirmed. Retry Stop before starting more work.'
        );
      }
      if (command.type === 'abort') {
        const key = `${target.binding.runtimeId}:${String(target.epoch)}`;
        const existing = this.#stops.get(key);
        if (existing) {
          return existing;
        }
        this.#blocked.set(sessionId, generationKey);
        const stopping = stopSession(target, {
          readFleet: () => this.#readSubagentFleet(sessionId),
          readBackground: this.#readBackgroundTasks ? () => this.#readBackgroundTasks!(sessionId) : undefined,
        })
          .then((response) => {
            if (this.#blocked.get(sessionId) === generationKey) {
              this.#blocked.delete(sessionId);
            }
            this.#onCommandSucceeded(sessionId, command, this.#now().toISOString());
            return response;
          })
          .finally(() => {
            this.#stops.delete(key);
            this.#onCommandCompleted(sessionId);
          });
        this.#stops.set(key, stopping);
        return stopping;
      }
      return this.#execute(target, sessionId, command);
    });
  }

  /**
   * Applies a model or thinking mutation and reads back Pi's effective thinking state.
   *
   * @param sessionId Stable Web Session identity.
   * @param command Model or thinking mutation accepted by Pi.
   * @param expected Optional runtime generation fencing tokens.
   * @returns Effective level and levels supported by the selected model.
   */
  public async executeThinkingControl(
    sessionId: string,
    command: Extract<ManagedSessionCommand, { type: 'set_model' | 'set_thinking_level' }>,
    expected: RuntimeGenerationTarget = {}
  ): Promise<ThinkingStateDto> {
    return this.#withRuntime(sessionId, async (target) => {
      this.#assertTarget(target, expected);
      const mutationResponse = await this.#execute(target, sessionId, command);
      if (!responseSucceeded(mutationResponse)) {
        throw new SessionRuntimeError('SESSION_RUNTIME_STALE', `Pi rejected the ${command.type} command.`);
      }
      const [stateResponse, levelsResponse] = await Promise.all([
        target.execute({ type: 'get_state' }),
        target.execute({ type: 'get_available_thinking_levels' }),
      ]);
      return projectThinkingState(stateResponse, levelsResponse);
    });
  }

  /**
   * Applies one permission mutation to the exact acquired runtime generation.
   *
   * @param sessionId Stable Web Session identity.
   * @param mode Requested permission mode.
   * @param expected Optional runtime generation fencing tokens.
   * @returns Updated authoritative permission state.
   */
  public async executePermissionControl(
    sessionId: string,
    mode: PermissionMode,
    expected: RuntimeGenerationTarget = {}
  ): Promise<PermissionStateDto> {
    return this.#withRuntime(sessionId, async (target) => {
      this.#assertTarget(target, expected);
      return target.setPermissionMode(mode);
    });
  }

  /**
   * Applies the Plan extension's explicit command workflow and reads back branch-authoritative state.
   *
   * @param sessionId Stable Web Session identity.
   * @param mode Requested runtime work mode.
   * @param expected Optional runtime generation fencing tokens.
   * @returns Effective Plan mode state after the extension command completes.
   */
  public async executeWorkModeControl(
    sessionId: string,
    mode: RuntimeWorkMode,
    expected: RuntimeGenerationTarget = {},
    knowledge?: KnowledgeModeConfig
  ): Promise<PlanModeStateDto> {
    return this.#withRuntime(sessionId, async (target) => {
      this.#assertTarget(target, expected);
      const commandsResponse = await target.execute({ type: 'get_commands' });
      const commands = responseData<{ commands?: unknown[] }>(commandsResponse)?.commands ?? [];
      const available = hasPlanModeCommand(commands);
      const hasKnowledge = commands.some(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          (item as { name?: string }).name === 'knowledge' &&
          (item as { source?: string }).source === 'extension'
      );
      if (hasKnowledge && !this.#readPlanModeState(sessionId, available).knowledge) {
        await target.execute({ type: 'prompt', message: '/knowledge status' });
      }
      const current = this.#readPlanModeState(sessionId, available);
      if (current.workMode === mode && knowledge === undefined) {
        return current;
      }
      if ((mode === 'knowledge' || knowledge !== undefined) && !hasKnowledge) {
        throw new SessionRuntimeError(
          'SESSION_RUNTIME_STALE',
          '知识问答扩展未加载，请更新 Agent 并重启会话运行时'
        );
      }
      if (mode === 'plan' && !available) {
        throw new SessionRuntimeError(
          'SESSION_RUNTIME_STALE',
          'Plan mode is unavailable because the pi-plan-mode extension did not load.'
        );
      }
      /**
       * Forward extension controls without creating model inference or owning mode state in the Host.
       */
      const control = async (message: string): Promise<void> => {
        const response = await target.execute({ type: 'prompt', message });
        this.#onCommandCompleted(sessionId);
        if (!responseSucceeded(response)) {
          throw new SessionRuntimeError('SESSION_RUNTIME_STALE', `Pi rejected the ${mode} work mode.`);
        }
      };
      if (current.workMode === 'knowledge' && mode !== 'knowledge') {
        await control('/knowledge off');
      }
      if (current.workMode === 'plan' && mode !== 'plan') {
        await control('/plan exit');
      }
      if (knowledge !== undefined) {
        await control('/knowledge config ' + JSON.stringify(knowledge));
        const effective = this.#readPlanModeState(sessionId, available).knowledge;
        if (
          !effective ||
          JSON.stringify(effective.collectionIds) !== JSON.stringify(knowledge.collectionIds)
        ) {
          throw new SessionRuntimeError(
            'SESSION_RUNTIME_STALE',
            'Agent 未应用知识问答配置，请等待当前任务完成并检查扩展状态'
          );
        }
      }
      if (mode === 'knowledge') {
        await control('/knowledge on');
      } else if (mode === 'plan') {
        await control('/plan start');
      }
      const projected = this.#readPlanModeState(sessionId, available);
      if (projected.workMode !== mode) {
        throw new SessionRuntimeError(
          'SESSION_RUNTIME_STALE',
          '模式未切换，请等待当前任务结束并检查扩展状态'
        );
      }
      return projected;
    });
  }

  /**
   * Applies preference mutations to Pi in deterministic field order.
   */
  public async updatePreferences(sessionId: string, preferences: RuntimePreferenceUpdate): Promise<void> {
    await this.#withRuntime(sessionId, async (target) => {
      if (preferences.thinkingLevel !== undefined) {
        await this.#execute(target, sessionId, {
          type: 'set_thinking_level',
          level: preferences.thinkingLevel,
        });
      }
      if (preferences.steeringMode !== undefined) {
        await this.#execute(target, sessionId, {
          type: 'set_steering_mode',
          mode: preferences.steeringMode,
        });
      }
      if (preferences.followUpMode !== undefined) {
        await this.#execute(target, sessionId, {
          type: 'set_follow_up_mode',
          mode: preferences.followUpMode,
        });
      }
      if (preferences.autoCompactionEnabled !== undefined) {
        await this.#execute(target, sessionId, {
          type: 'set_auto_compaction',
          enabled: preferences.autoCompactionEnabled,
        });
      }
      if (preferences.autoRetryEnabled !== undefined) {
        await this.#execute(target, sessionId, {
          type: 'set_auto_retry',
          enabled: preferences.autoRetryEnabled,
        });
      }
    });
  }

  /**
   * Routes one Extension UI response after validating an optional runtime generation target.
   */
  public async respondToExtensionUi(
    sessionId: string,
    expected: RuntimeGenerationTarget,
    response: RpcExtensionUIResponse
  ): Promise<void> {
    await this.#withRuntime(sessionId, async (target) => {
      this.#assertTarget(target, expected);
      await target.respondToExtensionUi(response);
    });
  }

  /**
   * Applies optional client fencing tokens before a command reaches Pi.
   */
  #assertTarget(target: SessionRuntimeOperation, expected: RuntimeGenerationTarget): void {
    if (
      (expected.runtimeId !== undefined && target.binding.runtimeId !== expected.runtimeId) ||
      (expected.epoch !== undefined && target.binding.epoch !== expected.epoch)
    ) {
      throw new SessionRuntimeError('SESSION_RUNTIME_BINDING_MISMATCH', 'Runtime target is stale.');
    }
  }

  /**
   * Executes one command through an already acquired runtime and reports its outcome.
   */
  async #execute(
    target: SessionRuntimeOperation,
    sessionId: string,
    command: ManagedSessionCommand
  ): Promise<unknown> {
    const response = await target.execute(command);
    if (responseSucceeded(response)) {
      this.#onCommandSucceeded(sessionId, command, this.#now().toISOString());
    }
    this.#onCommandCompleted(sessionId);
    return response;
  }
}

/**
 * Validates Pi query responses before exposing thinking state to application layers.
 *
 * @param stateResponse Pi get_state response envelope.
 * @param levelsResponse Pi get_available_thinking_levels response envelope.
 * @returns Validated effective thinking state.
 */
export function projectThinkingState(stateResponse: unknown, levelsResponse: unknown): ThinkingStateDto {
  const state = responseData<{ thinkingLevel?: unknown }>(stateResponse);
  const levels = responseData<{ levels?: unknown }>(levelsResponse);
  const level = state?.thinkingLevel;
  if (!isThinkingLevel(level) || !Array.isArray(levels?.levels)) {
    throw new SessionRuntimeError('SESSION_RUNTIME_STALE', 'Pi returned incomplete thinking state.');
  }
  const availableLevels = levels.levels.filter(isThinkingLevel);
  if (
    availableLevels.length !== levels.levels.length ||
    availableLevels.length === 0 ||
    !availableLevels.includes(level)
  ) {
    throw new SessionRuntimeError('SESSION_RUNTIME_STALE', 'Pi returned invalid thinking levels.');
  }
  return { level, availableLevels };
}
