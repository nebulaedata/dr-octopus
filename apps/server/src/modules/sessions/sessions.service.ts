/**
 * @author Codex
 * @description 统一编排 Session Repository、Workspace 权限、Pi runtime 命令、快照与离线派生
 */

import { isThinkingLevel } from '@octopus/shared/protocol';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import {
  PiSessionRepository,
  RuntimeArtifacts,
  RuntimeCommands,
  RuntimeEventProjection,
  SessionRuntimeError,
  projectGoalState,
  projectPlanModeState,
  projectThinkingState,
  responseData,
} from '../../infrastructure/runtime/index.js';
import { isRecord } from '../../utils/value-utils.js';
import { normalizeSessionTitle, toRuntimeDto } from './sessions.utils.js';
import type { MessageFeedbackRepository } from './sessions.repository.js';
import type { SessionsRepository } from './sessions.repository.js';
import type {
  RpcExtensionUIResponse,
  RpcSessionState,
  SessionEntry,
  SessionStats,
} from '@earendil-works/pi-coding-agent';
import type {
  CommandCatalogDto,
  CommandDto,
  DeleteSessionOptionsDto,
  HostEventEnvelope,
  MessageFeedbackDto,
  ModelDto,
  PermissionMode,
  PermissionStateDto,
  PlanModeStateDto,
  RestartSessionBody,
  RuntimeWorkMode,
  SessionBootstrapDto,
  SessionDto,
  SessionHistoryDto,
  SessionPreferencesDto,
  SessionRuntimeDto,
  SessionSnapshotDto,
  ThinkingLevel,
  ThinkingStateDto,
} from '@octopus/shared/protocol';
import type { MessageAttachmentDto } from '@octopus/shared/protocol/attachments';
import type { KnowledgeModeConfig } from '@octopus/shared/protocol/knowledge';

import type {
  ManagedSessionCommand,
  RuntimeGenerationTarget,
  SessionRuntimeCoordinator,
  SessionRuntimeOperation,
  SessionRuntimeRequestOptions,
} from '../../infrastructure/runtime/index.js';
import type { SessionNotificationsRepository } from './sessions.repository.js';
import type { WorkspaceService } from '@octopus/agent';
import type { SettingsService } from '../model-settings/index.js';

/**
 * Exposes Session use cases shared by HTTP and realtime transport Adapters.
 */
export class SessionsService {
  readonly notifications: Pick<
    SessionNotificationsRepository,
    | 'registerResult'
    | 'findRun'
    | 'runReceipts'
    | 'taskReceipts'
    | 'has'
    | 'publish'
    | 'markRead'
    | 'markAllRead'
    | 'list'
    | 'unreadCount'
    | 'removeRun'
  >;
  readonly #drafts: SessionDraftsService;
  readonly #refreshConfiguration: () => Promise<unknown>;
  readonly #runtime: SessionRuntimeCoordinator;
  readonly #sessions: SessionsRepository;
  readonly #feedback: MessageFeedbackRepository;
  readonly #workspaces: SessionsServiceOptions['workspaceService'];
  readonly #commands: RuntimeCommands;
  readonly #events: RuntimeEventProjection;
  readonly #artifacts: RuntimeArtifacts;
  readonly #modelSettings: SessionsServiceOptions['modelSettings'];
  readonly #createSessionId: () => string;
  readonly #messageEntryCache = new Map<string, { cursor?: string; entries: SessionEntry[] }>();
  readonly #listMessageAttachments: (sessionId: string) => Map<string, MessageAttachmentDto[]>;
  /**
   * Receives the aggregate's repositories and runtime explicitly.
   */
  public constructor(options: SessionsServiceDependencies) {
    this.#runtime = options.runtime;
    this.#modelSettings = options.modelSettings;
    this.#refreshConfiguration = () => options.refreshConfiguration?.() ?? Promise.resolve();
    this.#sessions = options.sessionsRepository;
    this.#feedback = options.messageFeedbackRepository;
    this.#workspaces = options.workspaceService;
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#drafts = new SessionDraftsService({
      repository: this.#sessions,
      runtime: this.#runtime,
      prepare: async (workspaceId, draftId) => {
        const existing = this.#sessions.get(draftId);
        if (existing !== undefined) {
          if (existing.workspaceId !== workspaceId || !existing.isDraft) {
            throw new ApplicationError(
              'SESSION_DRAFT_CONFLICT',
              'Prepare a new conversation before sending.',
              { statusCode: 409 }
            );
          }
          await this.activate(draftId);
          this.#sessions.touch(draftId);
          return this.getSession(draftId);
        }
        return this.#createSession(workspaceId, 'New session', draftId);
      },
      remove: async (sessionId) => this.deleteSession(sessionId, { deleteFiles: true }),
      onError: (error) => options.onDraftError(error),
    });
    this.#listMessageAttachments = options.listMessageAttachments ?? (() => new Map());
    this.#events = new RuntimeEventProjection(this.#runtime, {
      onMessageActivity: (sessionId, timestamp) => this.#sessions.recordLastMessageAt(sessionId, timestamp),
    });
    this.#commands = new RuntimeCommands({
      withRuntime: async (sessionId, operation) => this.#withSessionRuntime(sessionId, operation),
      onCommandSucceeded: (sessionId, command, timestamp) =>
        this.#projectSuccessfulCommand(sessionId, command, timestamp),
      onCommandCompleted: (sessionId) => this.#sessions.touch(sessionId),
      readSubagentFleet: (sessionId) => this.#events.getSubagentFleet(sessionId),
      readBackgroundTasks: (sessionId) => this.#events.getBackgroundTasks(sessionId),
      readPlanModeState: (sessionId, available) => this.#readPlanModeState(sessionId, available),
    });
    this.#artifacts = new RuntimeArtifacts({
      piSessions: options.piSessionsRepository ?? new PiSessionRepository(),
      execute: async (sessionId, command) => this.#commands.execute(sessionId, command),
    });

    this.notifications = {
      registerResult: (...args) => options.notificationsRepository.registerResult(...args),
      findRun: (...args) => options.notificationsRepository.findRun(...args),
      runReceipts: (...args) => options.notificationsRepository.runReceipts(...args),
      taskReceipts: (...args) => options.notificationsRepository.taskReceipts(...args),
      has: (...args) => options.notificationsRepository.has(...args),
      publish: (...args) => options.notificationsRepository.publish(...args),
      markRead: (...args) => options.notificationsRepository.markRead(...args),
      markAllRead: (...args) => options.notificationsRepository.markAllRead(...args),
      list: (...args) => options.notificationsRepository.list(...args),
      unreadCount: (...args) => options.notificationsRepository.unreadCount(...args),
      removeRun: (...args) => options.notificationsRepository.removeRun(...args),
    };
  }

  /**
   * 激活已登记 Session；已有 runtime 时保持原绑定。
   */
  public async activate(sessionId: string): Promise<SessionRuntimeDto> {
    await this.#refreshConfiguration();
    this.#assertInteractive(sessionId);
    const row = this.#requireSessionRow(sessionId);
    const workspace = await this.#workspaces.resolve({ id: row.workspaceId });
    const binding = await this.#runtime.activateExisting({
      workspace,
      sessionId: row.id,
      sessionPath: row.agentSessionPath,
      expectedAgentSessionId: row.agentSessionId,
    });
    return toRuntimeDto(binding);
  }

  /**
   * Restores the original Session through a fenced, user-requested runtime restart.
   */
  public async restart(sessionId: string, request: RestartSessionBody): Promise<SessionDto> {
    const row = this.#requireSessionRow(sessionId);
    if (row.execution || this.#sessions.get(sessionId)?.isDraft) {
      throw new ApplicationError('SESSION_RESTART_UNSUPPORTED', '此会话不支持重启。', { statusCode: 409 });
    }
    await this.#refreshConfiguration();
    const workspace = await this.#workspaces.resolve({ id: row.workspaceId });
    try {
      await this.#runtime.restart(
        {
          workspace,
          sessionId,
          sessionPath: row.agentSessionPath,
          expectedAgentSessionId: row.agentSessionId,
        },
        request
      );
      return this.getSession(sessionId);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError('SESSION_RESTART_FAILED', '会话重启失败，请重试。', {
        statusCode: 502,
        cause: error,
      });
    }
  }

  /**
   * Reserves one resident Runtime for the lifetime of a realtime Session subscription.
   *
   * @param sessionId Stable Web Session identity.
   * @returns Runtime projection and an idempotent release callback owned by the Channel connection.
   */
  public async acquireSubscription(
    sessionId: string
  ): Promise<{ runtime: SessionRuntimeDto; release: () => void }> {
    this.#assertInteractive(sessionId);
    const row = this.#requireSessionRow(sessionId);
    const workspace = await this.#workspaces.resolve({ id: row.workspaceId });
    const reservation = await this.#runtime.reserveExisting({
      workspace,
      sessionId: row.id,
      sessionPath: row.agentSessionPath,
      expectedAgentSessionId: row.agentSessionId,
    });
    return { runtime: toRuntimeDto(reservation.binding), release: reservation.release };
  }

  /**
   * 创建可对话 Pi Session 并登记其稳定身份。
   */
  public async createSession(workspaceId: string, title = 'New session'): Promise<SessionDto> {
    return this.#createSession(workspaceId, title);
  }

  /**
   * Prewarms a browser-owned draft without publishing it to the Session catalog.
   */
  public prepareDraftSession(workspaceId: string, draftId: string): Promise<SessionDto> {
    return this.#drafts.prepare(workspaceId, draftId);
  }

  /**
   * Commits the existing warmed identity immediately before the user's first prompt.
   */
  public publishDraftSession(sessionId: string, title: string): SessionDto {
    this.#requireSessionRow(sessionId);
    this.#drafts.assertAvailable(sessionId);
    return this.#withRuntime(this.#sessions.publishDraft(sessionId, normalizeSessionTitle(title)));
  }

  /**
   * Creates the same runtime for persistent and unpublished Sessions using the existing admission queue.
   */
  async #createSession(workspaceId: string, title: string, draftId?: string): Promise<SessionDto> {
    const workspace = await this.#workspaces.resolve({ id: workspaceId });
    const sessionId = draftId ?? this.#createSessionId();
    const binding = await this.#runtime.activateNew({ workspace, sessionId });
    try {
      const timestamp = new Date().toISOString();
      const row = {
        id: sessionId,
        workspaceId,
        agentSessionId: binding.agentSessionId,
        agentSessionPath: binding.sessionPath,
        title: normalizeSessionTitle(title),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActiveAt: timestamp,
        ...(draftId === undefined ? { lastMessageAt: timestamp } : {}),
      };
      return this.#withRuntime(
        draftId === undefined ? this.#sessions.upsert(row) : this.#sessions.createDraft(row)
      );
    } catch (error) {
      await this.#runtime.stop(binding.runtimeId);
      throw error;
    }
  }

  /**
   * 返回带当前 runtime 投影的 Session。
   */
  public getSession(sessionId: string): SessionDto {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      throw new SessionRuntimeError('SESSION_NOT_FOUND', `Session was not found: ${sessionId}`);
    }
    return this.#withRuntime(session);
  }

  /**
   * 列出带 runtime 投影的 Session。
   */
  public async listSessions(workspaceId: string, search?: string): Promise<SessionDto[]> {
    await this.#workspaces.resolve({ id: workspaceId });
    return this.#sessions
      .list({
        workspaceId,
        ...(search === undefined ? {} : { search }),
      })
      .map((session) => this.#withRuntime(session));
  }

  /**
   * 删除 Session 元数据，并先停止其驻留 runtime；如指定则同时删除底层 JSONL 文件。
   */
  public async deleteSession(sessionId: string, options?: DeleteSessionOptionsDto): Promise<boolean> {
    if (options?.deleteFiles) {
      this.#assertInteractive(sessionId);
    }
    return this.#runtime.deleteSession(sessionId, async () => {
      const row = this.#sessions.getRow(sessionId);
      const deleted = this.#sessions.delete(sessionId);
      this.#messageEntryCache.delete(sessionId);
      if (options?.deleteFiles && row !== undefined) {
        await this.#artifacts.deleteSessionFiles(row.agentSessionPath);
      }
      return deleted;
    });
  }

  /**
   * 发送允许的 Pi Session 命令并更新活动时间。
   */
  public async execute(
    sessionId: string,
    command: ManagedSessionCommand,
    expected: RuntimeGenerationTarget = {}
  ): Promise<unknown> {
    this.#assertInteractive(sessionId);
    if (command.type === 'prompt') {
      await this.#refreshConfiguration();
      if (this.#runtime.getControl(sessionId).restartRequired) {
        throw new ApplicationError(
          'SESSION_CONFIGURATION_STALE',
          'Configuration changed. Apply the update before sending another message.',
          { statusCode: 409 }
        );
      }
    }
    await this.#assertChatModel(command);
    return this.#commands.execute(sessionId, command, expected);
  }

  /**
   * Updates only the Web Session Catalog display title without mutating Pi Session metadata.
   */
  public renameSession(sessionId: string, title: string): SessionDto {
    return this.#sessions.rename(sessionId, normalizeSessionTitle(title));
  }

  /**
   * Persists one Session's pinned state and translates the catalog limit into a stable domain error.
   */
  public setSessionPinned(sessionId: string, pinned: boolean): SessionDto {
    try {
      return this.#sessions.setPinned(sessionId, pinned);
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_PIN_LIMIT') {
        throw new SessionRuntimeError('SESSION_PIN_LIMIT', 'A Workspace can pin at most 3 sessions.');
      }
      throw error;
    }
  }

  /**
   * Requires a Web Session catalog record to be a child of the requested Workspace.
   */
  public async assertWorkspaceSession(workspaceId: string, sessionId: string): Promise<void> {
    await this.#workspaces.resolve({ id: workspaceId });
    const row = this.#sessions.getRow(sessionId);
    if (row === undefined || row.workspaceId !== workspaceId) {
      throw new SessionRuntimeError('SESSION_NOT_FOUND', `Session was not found: ${sessionId}`);
    }
  }

  /**
   * Resolve a Web Session to the stable Pi Session identity used by Agent-owned services.
   */
  public async resolveAgentSessionRef(workspaceId: string, sessionId: string): Promise<string> {
    await this.assertWorkspaceSession(workspaceId, sessionId);
    return this.#requireSessionRow(sessionId).agentSessionId;
  }

  /**
   * Project an Agent Session identity back to its Web catalog identity when it is still registered.
   */
  public findSessionIdByAgentRef(workspaceId: string, agentSessionId: string): string | null {
    const row = this.#sessions.getByAgentSessionId(agentSessionId);
    return row?.workspaceId === workspaceId ? row.id : null;
  }

  /**
   * Resolves the trusted Workspace descriptor owned by one registered Session.
   */
  public async resolveWorkspace(sessionId: string) {
    const row = this.#requireSessionRow(sessionId);
    return this.#workspaces.resolve({ id: row.workspaceId });
  }

  /**
   * Reads the selected model's public input capabilities for attachment adaptation.
   */
  public async getActiveModelInputs(sessionId: string): Promise<ReadonlySet<'text' | 'image'>> {
    const session = this.getSession(sessionId);
    const models = await this.getModels(sessionId);
    const model = models.find(
      (candidate) => candidate.provider === session.provider && candidate.id === session.model
    );
    return new Set(model?.input ?? ['text']);
  }

  /**
   * Applies preference mutations through Pi and returns the persisted control-plane projection.
   */
  public async updatePreferences(
    sessionId: string,
    preferences: Partial<SessionPreferencesDto>
  ): Promise<SessionDto> {
    const { thinkingLevel, ...remainingPreferences } = preferences;
    if (thinkingLevel !== undefined) {
      await this.executeThinkingControl(sessionId, {
        type: 'set_thinking_level',
        level: thinkingLevel,
      });
    }
    await this.#commands.updatePreferences(sessionId, remainingPreferences);
    return this.getSession(sessionId);
  }

  /**
   * Applies a model or thinking mutation and persists only Pi's effective level.
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
    await this.#assertChatModel(command);
    const thinking = await this.#commands.executeThinkingControl(sessionId, command, expected);
    this.#sessions.updatePreferences(sessionId, { thinkingLevel: thinking.level });
    return thinking;
  }

  /**
   * Changes the permission mode for one exact runtime generation.
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
    return this.#commands.executePermissionControl(sessionId, mode, expected);
  }

  /**
   * Applies one Agent/Plan work-mode transition through the pinned pi-plan-mode command workflow.
   *
   * @param sessionId Stable Web Session identity.
   * @param mode Requested runtime work mode.
   * @param expected Optional runtime generation fencing tokens.
   * @returns Effective branch-authoritative Plan mode state.
   */
  public async executeWorkModeControl(
    sessionId: string,
    mode: RuntimeWorkMode,
    expected: RuntimeGenerationTarget = {},
    knowledge?: KnowledgeModeConfig
  ): Promise<PlanModeStateDto> {
    return this.#commands.executeWorkModeControl(sessionId, mode, expected, knowledge);
  }

  /**
   * 发送 Extension UI 响应，并清理服务端 pending 投影。
   */
  public async respondToExtensionUi(
    sessionId: string,
    expected: RuntimeGenerationTarget,
    response: RpcExtensionUIResponse
  ): Promise<void> {
    await this.#commands.respondToExtensionUi(sessionId, expected, response);
    this.#events.resolveExtensionUi(sessionId, response);
  }

  /**
   * 读取可用于首次加载或 gap reconcile 的权威快照。
   */
  public async getSnapshot(sessionId: string): Promise<SessionSnapshotDto> {
    return this.#withSessionRuntime(sessionId, async (target) => {
      const [
        stateResponse,
        thinkingLevelsResponse,
        messagesResponse,
        entriesResponse,
        statsResponse,
        commandsResponse,
        permission,
      ] = await Promise.all([
        target.execute({ type: 'get_state' }),
        target.execute({ type: 'get_available_thinking_levels' }),
        target.execute({ type: 'get_messages' }),
        target.execute({ type: 'get_entries' }),
        target.execute({ type: 'get_session_stats' }),
        target.execute({ type: 'get_commands' }),
        target.getPermissionState(),
      ]);
      const state = responseData<RpcSessionState>(stateResponse);
      const messageData = responseData<{ messages?: unknown[] }>(messagesResponse);
      const entryData = responseData<{ entries?: SessionEntry[]; leafId?: string | null }>(entriesResponse);
      const stats = responseData<SessionStats>(statsResponse);
      const entries = entryData?.entries ?? [];
      const commands = this.#projectCommands(commandsResponse).commands;
      const planModeAvailable = this.#reconcilePlanModeAvailability(sessionId, commands);
      if (
        this.#events.getKnowledgeMode(sessionId) === undefined &&
        commands.some((command) => command.name === 'knowledge' && command.source === 'extension')
      ) {
        await target.execute({ type: 'prompt', message: '/knowledge status' });
      }
      const activeRetry = this.#events.getActiveRetry(sessionId);
      return {
        session: this.#projectRuntimeModel(sessionId, state),
        thinking: projectThinkingState(stateResponse, thinkingLevelsResponse),
        permission,
        runtime: toRuntimeDto(target.getCurrentBinding()),
        sequence: this.#events.getSequence(sessionId),
        generatedAt: Date.now(),
        ...(entries.at(-1)?.id === undefined ? {} : { cursor: entries.at(-1)!.id }),
        ...(state === undefined ? {} : { state }),
        ...(stats?.contextUsage === undefined ? {} : { contextUsage: stats.contextUsage }),
        messages: this.#projectPersistedMessages(
          messageData?.messages ?? [],
          entries,
          this.#listMessageAttachments(sessionId)
        ),
        messageFeedback: this.#feedback.listBySession(sessionId),
        pendingExtensionUi: this.#events.getPendingExtensionUi(sessionId),
        ...(activeRetry === undefined ? {} : { activeRetry }),
        subagentFleet: this.#events.getSubagentFleet(sessionId),
        backgroundTasks: this.#events.getBackgroundTasks(sessionId),
        goal: projectGoalState(
          this.#artifacts.getBranch(this.#requireSessionRow(sessionId).agentSessionPath)
        ),
        planMode: this.#readPlanModeState(sessionId, planModeAvailable),
        memory: this.#events.getMemory(sessionId),
      };
    });
  }

  /**
   * Loads every Composer-critical Runtime resource under one fenced operation lease.
   *
   * @param sessionId Stable Web Session identity.
   * @param request Caller cancellation and deadline policy.
   * @returns Authoritative snapshot, capabilities, and explicit readiness contract.
   */
  public async getBootstrap(
    sessionId: string,
    request: SessionRuntimeRequestOptions = {}
  ): Promise<SessionBootstrapDto> {
    return this.#withSessionRuntime(
      sessionId,
      async (target) => {
        const [
          stateResponse,
          messagesResponse,
          entriesResponse,
          statsResponse,
          modelsResponse,
          commandsResponse,
          thinkingLevelsResponse,
          permission,
        ] = await Promise.all([
          target.execute({ type: 'get_state' }),
          target.execute({ type: 'get_messages' }),
          target.execute({ type: 'get_entries' }),
          target.execute({ type: 'get_session_stats' }),
          target.execute({ type: 'get_available_models' }),
          target.execute({ type: 'get_commands' }),
          target.execute({ type: 'get_available_thinking_levels' }),
          target.getPermissionState(),
        ]);
        const state = responseData<RpcSessionState>(stateResponse);
        const messageData = responseData<{ messages?: unknown[] }>(messagesResponse);
        const entryData = responseData<{ entries?: SessionEntry[] }>(entriesResponse);
        const stats = responseData<SessionStats>(statsResponse);
        const entries = entryData?.entries ?? [];
        const commands = this.#projectCommands(commandsResponse).commands;
        const planModeAvailable = this.#reconcilePlanModeAvailability(sessionId, commands);
        if (
          this.#events.getKnowledgeMode(sessionId) === undefined &&
          commands.some((command) => command.name === 'knowledge' && command.source === 'extension')
        ) {
          await target.execute({ type: 'prompt', message: '/knowledge status' });
        }
        const activeRetry = this.#events.getActiveRetry(sessionId);
        return {
          session: this.#projectRuntimeModel(sessionId, state),
          thinking: projectThinkingState(stateResponse, thinkingLevelsResponse),
          permission,
          runtime: toRuntimeDto(target.getCurrentBinding()),
          sequence: this.#events.getSequence(sessionId),
          generatedAt: Date.now(),
          ...(entries.at(-1)?.id === undefined ? {} : { cursor: entries.at(-1)!.id }),
          ...(state === undefined ? {} : { state }),
          ...(stats?.contextUsage === undefined ? {} : { contextUsage: stats.contextUsage }),
          messages: this.#projectPersistedMessages(
            messageData?.messages ?? [],
            entries,
            this.#listMessageAttachments(sessionId)
          ),
          messageFeedback: this.#feedback.listBySession(sessionId),
          pendingExtensionUi: this.#events.getPendingExtensionUi(sessionId),
          ...(activeRetry === undefined ? {} : { activeRetry }),
          subagentFleet: this.#events.getSubagentFleet(sessionId),
          backgroundTasks: this.#events.getBackgroundTasks(sessionId),
          goal: projectGoalState(
            this.#artifacts.getBranch(this.#requireSessionRow(sessionId).agentSessionPath)
          ),
          planMode: this.#readPlanModeState(sessionId, planModeAvailable),
          memory: this.#events.getMemory(sessionId),
          commands,
          models: await this.#filterChatModels(this.#artifacts.projectModels(modelsResponse)),
          readiness: {
            ready: true,
            runtimeId: target.binding.runtimeId,
            epoch: target.binding.epoch,
            resources: 'ready',
          },
        };
      },
      request
    );
  }

  /**
   * Reads display-only current-branch history without activating a process or projecting runtime readiness.
   */
  public getHistory(sessionId: string): SessionHistoryDto {
    this.#assertInteractive(sessionId);
    const row = this.#requireSessionRow(sessionId);
    const entries = this.#artifacts.getBranch(row.agentSessionPath);
    const messages = entries.flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
    return {
      sessionId,
      messages: this.#projectPersistedMessages(messages, entries, this.#listMessageAttachments(sessionId)),
      messageFeedback: this.#feedback.listBySession(sessionId),
    };
  }

  /**
   * Reads persisted append-order entries without activating the runtime.
   */
  public getEntries(sessionId: string, since?: string): { entries: SessionEntry[]; leafId: string | null } {
    return this.#artifacts.getEntries(this.#requireSessionRow(sessionId).agentSessionPath, since);
  }

  /**
   * 保存或更新某条消息的用户反馈。
   *
   * @param sessionId - Session 标识。
   * @param entryId - Pi history entry 标识。
   * @param rating - 'up' 或 'down'。
   * @returns 保存后的反馈 DTO。
   */
  public submitFeedback(sessionId: string, entryId: string, rating: 'up' | 'down'): MessageFeedbackDto {
    this.#requireSessionRow(sessionId);
    return this.#feedback.upsert(sessionId, entryId, rating);
  }

  /**
   * Checks whether a payload represents a message lifecycle event that may need entryId enrichment.
   */
  #isMessageLifecyclePayload(payload: unknown): boolean {
    if (!isRecord(payload)) {
      return false;
    }
    const type = typeof payload['type'] === 'string' ? payload['type'] : '';
    return type === 'message_start' || type === 'message_end';
  }

  /**
   * Attaches the Pi history identity and persistence time to a message lifecycle event.
   */
  #enrichMessageEvent(event: HostEventEnvelope): HostEventEnvelope {
    const payload = isRecord(event.payload) ? event.payload : undefined;
    if (payload === undefined) {
      return event;
    }
    const message = isRecord(payload['message']) ? payload['message'] : undefined;
    if (message === undefined) {
      return event;
    }
    const entry = this.#resolveMessageEntry(event.sessionId, message);
    if (entry === undefined) {
      return event;
    }
    return {
      ...event,
      payload: {
        ...payload,
        message: { ...message, entryId: entry.id, persistedAt: entry.timestamp },
      },
    };
  }

  /**
   * Resolves one emitted Pi message to its durable Session entry id.
   *
   * Messages are matched by their runtime timestamp and role, because Pi stores the
   * identical message object inside the entry and the event is emitted before the
   * entry is persisted.
   *
   * @param sessionId - Stable Web Session identity.
   * @param message - Pi message object carried by the event.
   * @returns The matching durable message entry, or undefined when persistence has not completed.
   */
  #resolveMessageEntry(
    sessionId: string,
    message: Record<string, unknown>
  ): Extract<SessionEntry, { type: 'message' }> | undefined {
    const row = this.#sessions.getRow(sessionId);
    if (row === undefined) {
      return undefined;
    }
    const cached = this.#messageEntryCache.get(sessionId);
    const since = cached?.cursor;
    const fresh = this.#artifacts.getEntries(row.agentSessionPath, since).entries;
    const entries =
      cached === undefined || since === undefined || fresh.length > 0
        ? [...(cached?.entries ?? []), ...fresh]
        : cached.entries;
    const cursor = entries.at(-1)?.id;
    if (cursor !== undefined || cached === undefined) {
      this.#messageEntryCache.set(sessionId, { cursor, entries });
    }
    const messageEntries = entries.filter(
      (entry): entry is Extract<SessionEntry, { type: 'message' }> => entry.type === 'message'
    );
    const timestamp = message['timestamp'];
    const role = typeof message['role'] === 'string' ? message['role'] : '';
    for (let index = messageEntries.length - 1; index >= 0; index -= 1) {
      const entry = messageEntries[index];
      if (entry === undefined) {
        continue;
      }
      const entryMessage = entry.message;
      if (!isRecord(entryMessage)) {
        continue;
      }
      const entryRole = typeof entryMessage['role'] === 'string' ? entryMessage['role'] : '';
      if (entryMessage['timestamp'] === timestamp && entryRole === role) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Aligns runtime messages with durable entries and attaches persistence metadata.
   *
   * @param messages - 来自 Pi runtime 的消息数组。
   * @param entries - 来自 Pi runtime 的完整 entry 数组。
   * @returns Messages enriched with entry identity and persistence time.
   */
  #projectPersistedMessages(
    messages: unknown[],
    entries: SessionEntry[],
    attachmentsByEntry: Map<string, MessageAttachmentDto[]>
  ): unknown[] {
    const messageEntries = entries.filter(
      (entry): entry is Extract<SessionEntry, { type: 'message' }> => entry.type === 'message'
    );
    return messages.map((message, index) => {
      const entry = messageEntries[index];
      if (entry === undefined || typeof message !== 'object' || message === null) {
        return message;
      }
      const attachments = attachmentsByEntry.get(entry.id);
      return {
        ...(projectHostVisibleUserMessage(
          message,
          attachments !== undefined && attachments.length > 0
        ) as Record<string, unknown>),
        entryId: entry.id,
        persistedAt: entry.timestamp,
        ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
      };
    });
  }

  /**
   * 使用 Pi 公开 SessionManager 读取树结构。
   */
  public getTree(sessionId: string): ReturnType<PiSessionRepository['getTree']> {
    return this.#artifacts.getTree(this.#requireSessionRow(sessionId).agentSessionPath);
  }

  /**
   * 离线派生 Session，不替换或停止源 runtime。
   */
  public async deriveSession(
    sessionId: string,
    mode: 'fork' | 'clone',
    entryId?: string
  ): Promise<{ session: SessionDto; prefill?: string }> {
    const source = this.#requireSessionRow(sessionId);
    this.#assertInteractive(sessionId);
    const derived = await this.#artifacts.deriveSession(source.agentSessionPath, mode, entryId);
    const timestamp = new Date().toISOString();
    const session = this.#sessions.upsert({
      id: this.#createSessionId(),
      workspaceId: source.workspaceId,
      agentSessionId: derived.sessionId,
      agentSessionPath: derived.path,
      title: `${source.title} (${mode})`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { session, ...(derived.prefill === undefined ? {} : { prefill: derived.prefill }) };
  }

  /**
   * 获取模型列表并压缩为浏览器稳定 DTO。
   */
  public async getModels(sessionId: string): Promise<ModelDto[]> {
    return this.#filterChatModels(await this.#artifacts.getModels(sessionId));
  }

  /**
   * Preserves runtime availability while excluding explicitly non-chat models.
   */
  async #filterChatModels(models: ModelDto[]): Promise<ModelDto[]> {
    if (!this.#modelSettings) {
      return models;
    }
    return this.#modelSettings.filterChatModels(models);
  }

  /**
   * Rejects explicitly non-chat models; Pi validates availability in the active runtime.
   */
  async #assertChatModel(command: ManagedSessionCommand): Promise<void> {
    if (command.type !== 'set_model' || !this.#modelSettings) {
      return;
    }
    const models = await this.#modelSettings.filterChatModels([
      { provider: command.provider, id: command.modelId },
    ]);
    if (models.length === 0) {
      throw new ApplicationError('CONVERSATION_MODEL_REQUIRED', 'Choose an available model before sending.', {
        statusCode: 409,
      });
    }
  }

  /**
   * Merges Pi-invocable commands with the Host commands implemented by the Web product.
   */
  public async getCommands(sessionId: string): Promise<CommandCatalogDto> {
    const response = await this.#commands.execute(sessionId, { type: 'get_commands' });
    const catalog = this.#projectCommands(response);
    this.#reconcilePlanModeAvailability(sessionId, catalog.commands);
    return catalog;
  }

  /**
   * Aligns the event projection with the current Pi command catalog.
   *
   * @param sessionId Stable Web Session identity.
   * @param commands Browser-safe command catalog entries.
   * @returns Whether the Plan extension command is currently available.
   */
  #reconcilePlanModeAvailability(sessionId: string, commands: CommandDto[]): boolean {
    const available = commands.some(
      (command) => command.name === 'plan' && command.source === 'extension' && command.enabled
    );
    this.#events.setPlanModeAvailable(sessionId, available);
    return available;
  }

  /**
   * Validates and merges one Pi command response with Host-owned commands.
   *
   * @param response Pi get_commands response envelope.
   * @returns Browser-stable command catalog.
   */
  #projectCommands(response: unknown): CommandCatalogDto {
    const data = responseData<{
      commands?: Array<{
        name: string;
        description?: string;
        source: 'extension' | 'prompt' | 'skill';
      }>;
    }>(response);
    if (!Array.isArray(data?.commands)) {
      throw new ApplicationError(
        'SESSION_COMMAND_CATALOG_INVALID',
        'Pi returned an invalid command catalog.',
        {
          statusCode: 502,
        }
      );
    }
    return createSessionCommandCatalog(data.commands);
  }

  /**
   * 获取 Pi 导出的 HTML 内容，调用方不得暴露本地路径。
   */
  public async exportHtml(sessionId: string): Promise<string> {
    return this.#artifacts.exportHtml(sessionId);
  }

  /**
   * 订阅规范化 Host 事件，并为 message 生命周期事件附加 Pi entryId。
   *
   * @param listener 按 runtime sequence 接收事件的订阅方。
   * @returns 取消订阅并丢弃尚未发布事件的清理函数。
   */
  public onEvent(listener: (event: HostEventEnvelope) => void): () => void {
    const pendingEvents: HostEventEnvelope[] = [];
    let flushScheduled = false;
    let disposed = false;
    const unsubscribe = this.#events.onEvent((event) => {
      const thinkingLevel = this.#getThinkingLevelChanged(event);
      if (thinkingLevel !== undefined) {
        this.#sessions.updatePreferences(event.sessionId, { thinkingLevel });
      }
      const messageLifecycle = event.type === 'agent.event' && this.#isMessageLifecyclePayload(event.payload);
      if (!messageLifecycle && !flushScheduled) {
        listener(this.#enrichPlanModeState(this.#enrichGoalState(event)));
        return;
      }
      pendingEvents.push(event);
      if (flushScheduled) {
        return;
      }
      flushScheduled = true;
      // Pi 在 message_end 事件发出后才把 entry 写入 JSONL。将它与同一 tick 内的后续事件
      // 一起推迟，既让 appendMessage 完成，也保持浏览器依赖的 runtime sequence 顺序。
      queueMicrotask(() => {
        flushScheduled = false;
        if (disposed) {
          pendingEvents.length = 0;
          return;
        }
        const batch = pendingEvents.splice(0, pendingEvents.length);
        for (const pendingEvent of batch) {
          const projected =
            pendingEvent.type === 'agent.event' && this.#isMessageLifecyclePayload(pendingEvent.payload)
              ? this.#enrichMessageEvent(pendingEvent)
              : pendingEvent;
          listener(this.#enrichPlanModeState(this.#enrichGoalState(projected)));
        }
      });
    });
    return () => {
      disposed = true;
      pendingEvents.length = 0;
      unsubscribe();
    };
  }

  /**
   * Attaches the latest pi-goal branch state only to events that can follow a Goal transition.
   *
   * @param event Normalized runtime envelope.
   * @returns Original envelope or one carrying an explicit Goal state/clear projection.
   */
  #enrichGoalState(event: HostEventEnvelope): HostEventEnvelope {
    if (!this.#canFollowGoalTransition(event)) {
      return event;
    }
    const row = this.#sessions.getRow(event.sessionId);
    if (row === undefined) {
      return event;
    }
    try {
      return {
        ...event,
        goal: projectGoalState(this.#artifacts.getBranch(row.agentSessionPath)) ?? null,
      };
    } catch {
      return event;
    }
  }

  /**
   * Limits synchronous Session reads to lifecycle boundaries used by pi-goal 0.54.3.
   *
   * @param event Candidate runtime event.
   * @returns Whether Goal state may have changed immediately before the event.
   */
  #canFollowGoalTransition(event: HostEventEnvelope): boolean {
    if (event.type === 'extension.ui') {
      return isRecord(event.payload) && event.payload['method'] === 'notify';
    }
    if (event.type === 'agent.state') {
      return true;
    }
    if (event.type !== 'agent.event' || !isRecord(event.payload)) {
      return false;
    }
    const eventType = typeof event.payload['type'] === 'string' ? event.payload['type'] : '';
    return [
      'message_start',
      'message_end',
      'tool_execution_end',
      'agent_start',
      'agent_end',
      'agent_settled',
    ].includes(eventType);
  }

  /**
   * 释放订阅。
   */
  public dispose(): void {
    this.#drafts.dispose();
    this.#events.close();
  }

  /**
   * Removes unpublished files and runtimes during orderly Host shutdown.
   */
  public async closeDrafts(): Promise<void> {
    await this.#drafts.close();
  }

  /**
   * 返回包含路径的 Server 内部 Session 记录。
   */
  #requireSessionRow(sessionId: string) {
    const row = this.#sessions.getRow(sessionId);
    if (row === undefined) {
      throw new SessionRuntimeError('SESSION_NOT_FOUND', `Session was not found: ${sessionId}`);
    }
    return row;
  }

  /**
   * Preserve Scheduler artifacts as immutable execution evidence and prevent task grants reaching chat.
   */
  #assertInteractive(sessionId: string): void {
    if (this.#requireSessionRow(sessionId).execution) {
      throw new ApplicationError(
        'SESSION_EXECUTION_READ_ONLY',
        '执行结果为只读会话，请从定时任务管理执行或删除任务。',
        { statusCode: 409 }
      );
    }
  }

  /**
   * 尽力给 Session DTO 添加 runtime，不因 dormant 状态报错。
   */
  #withRuntime(session: SessionDto): SessionDto {
    const binding = this.#runtime.getBindingBySessionId(session.id);
    return {
      ...session,
      ...(binding === undefined ? {} : { runtime: toRuntimeDto(binding) }),
      runtimeControl:
        session.execution || session.isDraft
          ? { restartRequired: false, changedConfigRoutes: [], restart: { status: 'idle' } }
          : this.#runtime.getControl(session.id),
    };
  }

  /**
   * Reconciles Pi's resolved runtime model into the durable Web Session projection.
   */
  #projectRuntimeModel(sessionId: string, state: RpcSessionState | undefined): SessionDto {
    let session = this.getSession(sessionId);
    const model = state?.model;
    const thinkingLevel = state?.thinkingLevel;
    if (model !== undefined && (session.provider !== model.provider || session.model !== model.id)) {
      session = this.#withRuntime(this.#sessions.updateModel(sessionId, model.provider, model.id));
    }
    if (isThinkingLevel(thinkingLevel) && session.preferences.thinkingLevel !== thinkingLevel) {
      session = this.#sessions.updatePreferences(sessionId, { thinkingLevel });
    }
    return session;
  }

  /**
   * Attaches current branch-backed Plan state only at boundaries that may follow an extension transition.
   *
   * @param event Normalized runtime envelope.
   * @returns Original envelope or one carrying the effective Plan mode projection.
   */
  #enrichPlanModeState(event: HostEventEnvelope): HostEventEnvelope {
    if (!this.#canFollowPlanModeTransition(event)) {
      return event;
    }
    try {
      return {
        ...event,
        planMode: this.#readPlanModeState(event.sessionId, this.#events.isPlanModeAvailable(event.sessionId)),
      };
    } catch {
      return event;
    }
  }

  /**
   * Limits durable branch reads to lifecycle and UI boundaries used by pi-plan-mode 0.55.3.
   *
   * @param event Candidate runtime event.
   * @returns Whether Plan mode state may have changed immediately before the event.
   */
  #canFollowPlanModeTransition(event: HostEventEnvelope): boolean {
    if (event.type === 'extension.ui') {
      if (!isRecord(event.payload)) {
        return false;
      }
      return (
        event.payload['method'] === 'notify' ||
        (event.payload['method'] === 'setStatus' &&
          ['plan-mode', 'octopus-knowledge-mode'].includes(String(event.payload['statusKey'])))
      );
    }
    if (event.type === 'agent.state') {
      return true;
    }
    if (event.type !== 'agent.event' || !isRecord(event.payload)) {
      return false;
    }
    const eventType = typeof event.payload['type'] === 'string' ? event.payload['type'] : '';
    return [
      'entry_appended',
      'message_start',
      'message_end',
      'tool_execution_end',
      'agent_start',
      'agent_end',
      'agent_settled',
    ].includes(eventType);
  }

  /**
   * Reads and validates the pinned pi-plan-mode state from the Session's current durable branch.
   *
   * @param sessionId Stable Web Session identity.
   * @param available Whether the active runtime exposes the Plan extension command.
   * @returns Browser-safe Plan workflow projection.
   */
  #readPlanModeState(sessionId: string, available: boolean): PlanModeStateDto {
    const row = this.#requireSessionRow(sessionId);
    const plan = projectPlanModeState(this.#artifacts.getBranch(row.agentSessionPath), available);
    const knowledge = this.#events.getKnowledgeMode(sessionId);
    if (!knowledge) {
      return plan;
    }
    return { ...plan, knowledge, ...(knowledge.enabled ? { workMode: 'knowledge' as const } : {}) };
  }

  /**
   * Resolves catalog and Workspace authority before acquiring one runtime operation lease.
   */
  async #withSessionRuntime<T>(
    sessionId: string,
    operation: (target: SessionRuntimeOperation) => Promise<T>,
    request: SessionRuntimeRequestOptions = {}
  ): Promise<T> {
    this.#assertInteractive(sessionId);
    const row = this.#requireSessionRow(sessionId);
    const workspace = await this.#workspaces.resolve({ id: row.workspaceId });
    return this.#runtime.withExisting(
      {
        workspace,
        sessionId: row.id,
        sessionPath: row.agentSessionPath,
        expectedAgentSessionId: row.agentSessionId,
      },
      operation,
      request
    );
  }

  /**
   * Applies successful Pi command state to the Web Session Catalog.
   */
  #projectSuccessfulCommand(sessionId: string, command: ManagedSessionCommand, timestamp: string): void {
    if (command.type === 'set_model') {
      this.#sessions.updateModel(sessionId, command.provider, command.modelId);
    } else if (command.type === 'set_steering_mode') {
      this.#sessions.updatePreferences(sessionId, { steeringMode: command.mode });
    } else if (command.type === 'set_follow_up_mode') {
      this.#sessions.updatePreferences(sessionId, { followUpMode: command.mode });
    } else if (command.type === 'set_auto_compaction') {
      this.#sessions.updatePreferences(sessionId, { autoCompactionEnabled: command.enabled });
    } else if (command.type === 'set_auto_retry') {
      this.#sessions.updatePreferences(sessionId, { autoRetryEnabled: command.enabled });
    }
    if (command.type === 'prompt' || command.type === 'steer' || command.type === 'follow_up') {
      this.#sessions.recordLastMessageAt(sessionId, timestamp);
    }
  }

  /**
   * Extracts Pi's effective thinking level from its runtime event.
   *
   * @param event Normalized Host event envelope.
   * @returns Effective level when the event represents a thinking change.
   */
  #getThinkingLevelChanged(event: HostEventEnvelope): ThinkingLevel | undefined {
    if (event.type !== 'agent.event' || !isRecord(event.payload)) {
      return undefined;
    }
    return event.payload['type'] === 'thinking_level_changed' && isThinkingLevel(event.payload['level'])
      ? event.payload['level']
      : undefined;
  }
}

export interface SessionDraftsServiceOptions {
  repository: SessionsRepository;
  runtime: SessionRuntimeCoordinator;
  /**
   * Creates or reactivates the exact requested draft through the existing serialized coordinator.
   */
  prepare(workspaceId: string, draftId: string): Promise<SessionDto>;
  /**
   * Stops an owned draft and removes its Session artifacts.
   */
  remove(sessionId: string): Promise<unknown>;
  /**
   * Reports bounded background cleanup failures to the Host logger.
   */
  onError(error: unknown): void;
}

/**
 * Keeps per-browser drafts distinct while sharing repeated requests for one draft identity.
 */
export class SessionDraftsService {
  readonly #pending = new Map<string, { workspaceId: string; result: Promise<SessionDto> }>();
  readonly #retiring = new Set<string>();
  readonly #timer: NodeJS.Timeout;
  #cleanup: Promise<void> | undefined;
  #closed = false;

  /**
   * Starts unreferenced maintenance; live subscriptions protect drafts from idle reclamation.
   */
  public constructor(private readonly options: SessionDraftsServiceOptions) {
    this.#timer = setInterval(() => {
      void this.reap().catch((error) => options.onError(error));
    }, 60_000);
    this.#timer.unref();
  }

  /**
   * Shares one in-flight warmup per workspace and validated opaque browser draft ID.
   */
  public prepare(workspaceId: string, draftId: string): Promise<SessionDto> {
    this.assertAvailable(draftId);
    if (this.#closed) {
      throw new ApplicationError('SESSION_DRAFT_CLOSED', 'Session preparation is unavailable.', {
        statusCode: 503,
      });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)) {
      throw new ApplicationError('INVALID_SESSION_DRAFT', 'A valid draft identity is required.', {
        statusCode: 400,
      });
    }
    if (
      this.options.repository.get(draftId) === undefined &&
      this.options.runtime
        .getDiagnostics()
        .slots.some((slot) => slot.sessionId === draftId && slot.canonicalSessionPath !== undefined) &&
      !this.#pending.has(draftId)
    ) {
      throw new ApplicationError('SESSION_DRAFT_EXPIRED', 'Prepare a new conversation and try again.', {
        statusCode: 409,
      });
    }
    const key = draftId;
    const pending = this.#pending.get(key);
    if (pending !== undefined) {
      if (pending.workspaceId !== workspaceId) {
        throw new ApplicationError('SESSION_DRAFT_CONFLICT', 'Draft belongs to another workspace.', {
          statusCode: 409,
        });
      }
      return pending.result;
    }
    if (
      this.options.repository.get(draftId) === undefined &&
      this.#pending.size + this.options.repository.listDrafts().length >= 64
    ) {
      throw new ApplicationError(
        'SESSION_DRAFT_CAPACITY',
        'Too many prepared conversations. Try again later.',
        { statusCode: 429 }
      );
    }
    const preparation = this.options.prepare(workspaceId, draftId).finally(() => this.#pending.delete(key));
    this.#pending.set(key, { workspaceId, result: preparation });
    return preparation;
  }

  /**
   * Reclaims drafts unused for fifteen minutes, retaining any active subscription or runtime operation.
   */
  public reap(now = Date.now()): Promise<void> {
    if (this.#cleanup !== undefined) {
      return this.#cleanup;
    }
    const cleanup = this.#reap(now).finally(() => {
      this.#cleanup = undefined;
    });
    this.#cleanup = cleanup;
    return cleanup;
  }

  /**
   * Checks interest again before removal so a connected Composer keeps its warmed runtime and metadata.
   */
  async #reap(now: number): Promise<void> {
    for (const row of this.options.repository.listDrafts()) {
      if (now - Date.parse(row.lastActiveAt ?? row.createdAt) < 15 * 60_000) {
        continue;
      }
      const slot = this.options.runtime
        .getDiagnostics()
        .slots.find((candidate) => candidate.sessionId === row.id);
      if (
        slot !== undefined &&
        (slot.demandCount > 0 || slot.state === 'activating' || slot.state === 'draining')
      ) {
        continue;
      }
      if (!this.options.repository.get(row.id)?.isDraft) {
        continue;
      }
      this.#retiring.add(row.id);
      try {
        await this.options.remove(row.id);
      } finally {
        this.#retiring.delete(row.id);
      }
    }
  }

  /**
   * Stops maintenance immediately, including when tests dispose services without closing a full Host.
   */
  public dispose(): void {
    this.#closed = true;
    clearInterval(this.#timer);
  }

  /**
   * Rejects promotion or reuse once cleanup has claimed the unpublished runtime.
   */
  public assertAvailable(sessionId: string): void {
    if (this.#retiring.has(sessionId) || this.#closed) {
      throw new ApplicationError('SESSION_DRAFT_EXPIRED', 'Prepare a new conversation and try again.', {
        statusCode: 409,
      });
    }
  }

  /**
   * Waits for accepted preparations and removes remaining unpublished artifacts before Host shutdown.
   */
  public async close(): Promise<void> {
    this.dispose();
    await Promise.allSettled([...this.#pending.values()].map((pending) => pending.result));
    await this.#cleanup;
    for (const row of this.options.repository.listDrafts()) {
      await this.options.remove(row.id);
    }
  }
}

/**
 * Skip focused Sessions without recording them; publish unseen final settlements with notice deduplication.
 */
export function subscribeSessionCompletionNotices(
  sessions: SessionsService,
  notices: SessionsService['notifications'],
  onError: (error: unknown) => void,
  isSessionFocused: (sessionId: string) => boolean = () => false
): () => void {
  return sessions.onEvent((event) => {
    if (
      event.type !== 'agent.event' ||
      !event.payload ||
      typeof event.payload !== 'object' ||
      !('type' in event.payload) ||
      event.payload.type !== 'agent_settled'
    ) {
      return;
    }
    try {
      const session = sessions.getSession(event.sessionId);
      if (session.execution || isSessionFocused(session.id)) {
        return;
      }
      const transcript = sessions.getEntries(session.id);
      const entries = new Map(transcript.entries.map((candidate) => [candidate.id, candidate]));
      let entry = transcript.leafId ? entries.get(transcript.leafId) : undefined;
      while (entry && !(entry.type === 'message' && entry.message.role === 'assistant')) {
        entry = entry.parentId ? entries.get(entry.parentId) : undefined;
      }
      if (!entry || entry.type !== 'message' || entry.message.role !== 'assistant') {
        return;
      }
      const message = entry.message;
      let status: 'failed' | 'cancelled' | 'succeeded';
      if (message.stopReason === 'error') {
        status = 'failed';
      } else {
        if (message.stopReason === 'aborted') {
          status = 'cancelled';
        } else {
          status = 'succeeded';
        }
      }
      const summary =
        message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .slice(0, 500) ||
        message.errorMessage ||
        (status === 'succeeded' ? '回复已完成' : '执行已结束，请查看会话详情');
      notices.publish({
        eventKey: `reply:${session.id}:${entry.id}`,
        workspaceId: session.workspaceId,
        sessionId: session.id,
        title: session.title,
        summary,
        status,
        createdAt: event.timestamp,
      });
    } catch (error) {
      onError(error);
    }
  });
}

interface RuntimeCommand {
  name: string;
  description?: string;
  source: 'extension' | 'prompt' | 'skill';
}

const HOST_COMMANDS: readonly CommandDto[] = [
  {
    name: 'compact',
    description: 'Compact the current session context',
    source: 'host',
    execution: 'realtime',
    enabled: true,
  },
  {
    name: 'model',
    description: 'Select the active model',
    source: 'host',
    execution: 'client',
    enabled: true,
  },
  {
    name: 'new',
    description: 'Create a new session',
    source: 'host',
    execution: 'http',
    enabled: true,
  },
  {
    name: 'fork',
    description: 'Fork the current conversation',
    source: 'host',
    execution: 'http',
    enabled: true,
  },
  {
    name: 'clone',
    description: 'Clone the current session',
    source: 'host',
    execution: 'http',
    enabled: true,
  },
  {
    name: 'name',
    description: 'Rename the current session',
    source: 'host',
    execution: 'client',
    enabled: true,
  },
  {
    name: 'export',
    description: 'Export the current session as HTML',
    source: 'host',
    execution: 'http',
    enabled: true,
  },
  {
    name: 'settings',
    description: 'Open Web settings',
    source: 'host',
    execution: 'client',
    enabled: true,
  },
  {
    // TODO: Enable when the Web keyboard-shortcuts dialog is implemented.
    name: 'hotkeys',
    description: 'Show Web keyboard shortcuts (coming soon)',
    source: 'host',
    execution: 'client',
    enabled: false,
    disabledReason: 'The Web hotkeys guide is not available yet.',
  },
];

/**
 * Combines Host-owned commands with Pi commands while reserving names for supported Web behavior.
 *
 * @param runtimeCommands Commands returned by Pi RPC get_commands.
 * @returns Stable browser command catalog with one owner per invocation name.
 */
export function createSessionCommandCatalog(runtimeCommands: readonly RuntimeCommand[]): CommandCatalogDto {
  const commands = HOST_COMMANDS.map((command) => ({ ...command }));
  const reservedNames = new Set(commands.map((command) => command.name));
  for (const command of runtimeCommands) {
    if (reservedNames.has(command.name)) {
      continue;
    }
    reservedNames.add(command.name);
    commands.push({
      name: command.name,
      ...(command.description === undefined ? {} : { description: command.description }),
      source: command.source,
      execution: 'prompt',
      enabled: true,
    });
  }
  return { commands };
}

export interface SessionsServiceOptions {
  modelSettings?: Pick<SettingsService, 'filterChatModels'>;
  runtime?: SessionRuntimeCoordinator;
  /**
   * Reconciles effective configuration before activating or sending new work.
   */
  refreshConfiguration?(): Promise<unknown>;
  sessionsRepository?: SessionsRepository;
  messageFeedbackRepository?: MessageFeedbackRepository;
  workspaceService: WorkspaceService;
  piSessionsRepository?: PiSessionRepository;
  createSessionId?: () => string;
  listMessageAttachments?: (sessionId: string) => Map<string, MessageAttachmentDto[]>;
}

const HOST_CONTEXT_REQUEST_MARKER =
  /\r?\n<host_(attachment|workspace_reference)_request id="[^"\r\n]{1,1024}" \/>[\s\S]*$/u;

interface ProjectedHostText {
  text: string;
  hasHostContext: boolean;
  hasHostAttachmentContext: boolean;
}

/**
 * Removes Host-only context from a text block.
 *
 * @param text Text persisted by Pi after Host context adaptation.
 * @returns User-authored text and whether private Host context was present.
 */
function projectText(text: string): ProjectedHostText {
  const match = HOST_CONTEXT_REQUEST_MARKER.exec(text);
  if (match === null) {
    return { text, hasHostContext: false, hasHostAttachmentContext: false };
  }
  return {
    text: text.slice(0, match.index),
    hasHostContext: true,
    hasHostAttachmentContext: match[1] === 'attachment' || text.includes('\n<host_attachment_request id="'),
  };
}

/**
 * Produces the authoritative user-message shape exposed to Web clients.
 *
 * Pi persists model-facing Host context so crash recovery remains deterministic. This projection
 * hides that private suffix and suppresses Pi image/file blocks when Host attachment cards own them.
 *
 * @param message Arbitrary Pi message value.
 * @param hasAuthoritativeAttachments Whether Host message bindings own attachment presentation.
 * @returns The original value for non-user messages, otherwise a safe Host-visible projection.
 */
export function projectHostVisibleUserMessage(
  message: unknown,
  hasAuthoritativeAttachments = false
): unknown {
  if (!isRecord(message) || message['role'] !== 'user') {
    return message;
  }
  const content = message['content'];
  if (typeof content === 'string') {
    const projected = projectText(content);
    return projected.hasHostContext ? { ...message, content: projected.text } : message;
  }
  if (!Array.isArray(content)) {
    return message;
  }

  const blocks: unknown[] = content;
  let hasHostAttachmentContext = false;
  const projectedBlocks = blocks.map((block) => {
    if (!isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') {
      return block;
    }
    const projected = projectText(block['text']);
    hasHostAttachmentContext ||= projected.hasHostAttachmentContext;
    return projected.hasHostContext ? { ...block, text: projected.text } : block;
  });
  const hasHostContext = projectedBlocks.some((block, index) => block !== blocks[index]);
  if (!hasHostContext && !hasAuthoritativeAttachments) {
    return message;
  }
  const ownsAttachmentPresentation = hasHostAttachmentContext || hasAuthoritativeAttachments;
  const visibleBlocks = ownsAttachmentPresentation
    ? projectedBlocks.filter(
        (block) => !isRecord(block) || (block['type'] !== 'image' && block['type'] !== 'file')
      )
    : projectedBlocks;
  return { ...message, content: visibleBlocks };
}

export type SessionsServiceDependencies = SessionsServiceOptions & {
  runtime: SessionRuntimeCoordinator;
  sessionsRepository: SessionsRepository;
  messageFeedbackRepository: MessageFeedbackRepository;
  notificationsRepository: SessionNotificationsRepository;
  /**
   * Reports draft reclamation failures through the owning Host logger.
   */
  onDraftError(error: unknown): void;
};
