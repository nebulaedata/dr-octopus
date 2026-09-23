/**
 * @author Codex
 * @description Orchestrates logical Session channel subscriptions, commands, and event fan-out from the shared Server context.
 */

import { OCTOPUS_PROTOCOL_VERSION } from '@octopus/shared/protocol';
import {
  mutationFingerprint,
  MutationIdempotencyLedger,
} from '../../infrastructure/idempotency/mutation-ledger.js';
import { SessionRuntimeError } from '../../infrastructure/runtime/errors.js';
import { responseSucceeded } from '../../infrastructure/runtime/utils.js';
import { projectHostVisibleUserMessage } from '../sessions/index.js';
import { createWorkspaceReferencePromptSuffix } from './channel.utils.js';
import { issueKnowledgeImportTicket } from '@octopus/agent';
import type {
  ClientRealtimeMessage,
  HostEventEnvelope,
  PermissionStateDto,
  PlanModeStateDto,
  ServerRealtimeMessage,
  ThinkingStateDto,
  WorkspaceReferenceDto,
} from '@octopus/shared/protocol';

import type { ManagedSessionCommand } from '../../infrastructure/runtime/index.js';
import type { AttachmentDeliveryService } from '../attachment-delivery/index.js';
import type { AttachmentsService } from '../attachments/index.js';
import type { SessionsService } from '../sessions/index.js';

type SendMessage = (message: ServerRealtimeMessage) => void;
type SessionCommandResult =
  { thinking?: ThinkingStateDto; permission?: PermissionStateDto; planMode?: PlanModeStateDto } | undefined;

interface ChannelConnection {
  send: SendMessage;
  focusedSessionId: string | null;
  sessions: Map<string, { runtime: Awaited<ReturnType<SessionsService['activate']>>; release: () => void }>;
  operations: Map<string, Promise<void>>;
}

export interface ChannelServiceDependencies {
  /**
   * Optionally issue knowledge import references after normal attachment admission; failure cannot block ordinary prompts.
   */
  prepareKnowledgeAttachments?: (
    workspaceId: string,
    sessionId: string,
    ids: readonly string[]
  ) => Promise<string>;
  sessionsService: SessionsService;
  attachmentsService: AttachmentsService;
  attachmentDeliveryService: AttachmentDeliveryService;
  /**
   * Resolves the Host-authoritative cwd for the Workspace that owns a Session.
   */
  resolveWorkspaceCwd: (workspaceId: string) => Promise<string>;
  /**
   * Validates Browser-selected references against their authoritative Workspace.
   */
  resolveWorkspaceReferences: (
    workspaceId: string,
    references: readonly WorkspaceReferenceDto[]
  ) => Promise<WorkspaceReferenceDto[]>;
}

export interface ChannelServiceOptions {
  maxSubscriptions: number;
}

/**
 * Maintains logical channel state and maps protocol commands to application services.
 */
export class ChannelService {
  readonly #connections = new Map<string, ChannelConnection>();
  readonly #dependencies: ChannelServiceDependencies;
  readonly #maxSubscriptions: number;
  readonly #unsubscribeEvents: () => void;
  readonly #userMessages = new UserMessageRequestCorrelator();
  readonly #mutations = new MutationIdempotencyLedger();

  /**
   * Creates a channel service and subscribes once to the Session event source.
   *
   * @param server Fastify instance exposing application plugins.
   * @param dependencies Session and attachment application services.
   * @param options Channel resource limits.
   */
  public constructor(dependencies: ChannelServiceDependencies, options: ChannelServiceOptions) {
    this.#dependencies = dependencies;
    this.#maxSubscriptions = options.maxSubscriptions;
    this.#unsubscribeEvents = dependencies.sessionsService.onEvent((event) => this.#broadcast(event));
  }

  /**
   * Registers one transport connection and announces its negotiated protocol identity.
   */
  public connect(connectionId: string, send: SendMessage): void {
    if (this.#connections.has(connectionId)) {
      throw new Error('Connection is already registered.');
    }
    this.#connections.set(connectionId, {
      send,
      focusedSessionId: null,
      sessions: new Map(),
      operations: new Map(),
    });
    send({
      type: 'connection.ready',
      protocolVersion: OCTOPUS_PROTOCOL_VERSION,
      connectionId,
    });
  }

  /**
   * Reports whether any connected window is focused on this Session, without activating a runtime.
   */
  public isSessionFocused(sessionId: string): boolean {
    return [...this.#connections.values()].some((connection) => connection.focusedSessionId === sessionId);
  }

  /**
   * Removes all logical subscriptions owned by a disconnected transport.
   */
  public disconnect(connectionId: string): void {
    const connection = this.#connections.get(connectionId);
    if (connection === undefined) {
      return;
    }
    for (const subscription of connection.sessions.values()) {
      subscription.release();
    }
    this.#connections.delete(connectionId);
  }

  /**
   * Dispatches one validated protocol message for an active connection.
   */
  public handleMessage(connectionId: string, message: ClientRealtimeMessage): Promise<void> {
    const connection = this.#requireConnection(connectionId);
    if (message.type === 'ping' || message.type === 'session.focus') {
      return this.#dispatchMessage(connection, message);
    }
    const previous = connection.operations.get(message.sessionId) ?? Promise.resolve();
    const execution = previous.then(async () => {
      if (this.#connections.get(connectionId) !== connection) {
        throw new Error('Connection is no longer registered.');
      }
      await this.#dispatchMessage(connection, message);
    });
    const tail = execution.then(
      () => undefined,
      () => undefined
    );
    connection.operations.set(message.sessionId, tail);
    void tail.finally(() => {
      if (connection.operations.get(message.sessionId) === tail) {
        connection.operations.delete(message.sessionId);
      }
    });
    return execution;
  }

  /**
   * Executes one message after its per-Session connection queue reaches the head.
   */
  async #dispatchMessage(connection: ChannelConnection, message: ClientRealtimeMessage): Promise<void> {
    if (message.type === 'ping') {
      connection.send({
        type: 'pong',
        requestId: message.requestId,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (message.type === 'session.focus') {
      if (message.sessionId !== null && !connection.sessions.has(message.sessionId)) {
        throw new SessionRuntimeError(
          'SESSION_RUNTIME_BINDING_MISMATCH',
          'Subscribe before focusing a Session.'
        );
      }
      connection.focusedSessionId = message.sessionId;
      connection.send({ type: 'command.ack', requestId: message.requestId });
      return;
    }
    if (message.type === 'session.subscribe') {
      await this.#subscribe(connection, message.sessionId, message.requestId);
      return;
    }
    if (message.type === 'session.unsubscribe') {
      if (connection.focusedSessionId === message.sessionId) {
        connection.focusedSessionId = null;
      }
      connection.sessions.get(message.sessionId)?.release();
      connection.sessions.delete(message.sessionId);
      connection.send({
        type: 'session.unsubscribed',
        requestId: message.requestId,
        sessionId: message.sessionId,
      });
      return;
    }
    const subscription = connection.sessions.get(message.sessionId);
    if (subscription === undefined) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_BINDING_MISMATCH',
        'Subscribe to the Session before sending commands.'
      );
    }
    if (
      (message.runtimeId !== undefined && message.runtimeId !== subscription.runtime.runtimeId) ||
      (message.epoch !== undefined && message.epoch !== subscription.runtime.epoch)
    ) {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_BINDING_MISMATCH',
        'The command does not match the confirmed Session runtime generation.'
      );
    }
    const control = await this.#mutations.execute(
      {
        scope: message.sessionId,
        key: message.requestId,
        type: message.type,
        fingerprint: mutationFingerprint(message),
      },
      async () => {
        const correlatesUserMessage = isUserMessageCommand(message);
        if (correlatesUserMessage) {
          this.#userMessages.register(message);
        }
        try {
          return await this.#executeSessionCommand(message);
        } catch (error) {
          if (correlatesUserMessage) {
            this.#userMessages.cancel(message.sessionId, message.requestId);
          }
          throw error;
        }
      }
    );
    connection.send({
      type: 'command.ack',
      requestId: message.requestId,
      sessionId: message.sessionId,
      ...(control ?? {}),
    });
  }

  /**
   * Releases the Session event subscription and all logical connection state.
   */
  public close(): void {
    this.#unsubscribeEvents();
    for (const connection of this.#connections.values()) {
      for (const subscription of connection.sessions.values()) {
        subscription.release();
      }
    }
    this.#connections.clear();
    this.#userMessages.clear();
  }

  /**
   * Activates and subscribes a Session while enforcing the per-connection bound.
   */
  async #subscribe(connection: ChannelConnection, sessionId: string, requestId: string): Promise<void> {
    if (!connection.sessions.has(sessionId) && connection.sessions.size >= this.#maxSubscriptions) {
      throw new Error('Subscription limit reached.');
    }
    const existing = connection.sessions.get(sessionId);
    if (existing !== undefined) {
      connection.send({ type: 'session.subscribed', requestId, sessionId, runtime: existing.runtime });
      return;
    }
    const subscription = await this.#dependencies.sessionsService.acquireSubscription(sessionId);
    const sessionsService = this.#dependencies.sessionsService as SessionsService & {
      getEntries?: (id: string) => { entries: readonly unknown[] };
    };
    if (sessionsService.getEntries !== undefined) {
      this.#dependencies.attachmentsService.reconcilePromptReservations(
        sessionId,
        sessionsService.getEntries(sessionId).entries
      );
    }
    connection.sessions.set(sessionId, subscription);
    try {
      connection.send({
        type: 'session.subscribed',
        requestId,
        sessionId,
        runtime: subscription.runtime,
      });
    } catch (error) {
      connection.sessions.delete(sessionId);
      subscription.release();
      throw error;
    }
  }

  /**
   * Maps a non-subscription Session command onto the owning application services.
   */
  async #executeSessionCommand(message: ClientRealtimeMessage): Promise<SessionCommandResult> {
    if (
      message.type === 'ping' ||
      message.type === 'session.focus' ||
      message.type === 'session.subscribe' ||
      message.type === 'session.unsubscribe'
    ) {
      throw new Error('Channel control messages cannot be executed as Session commands.');
    }
    const sessions = this.#dependencies.sessionsService;
    const sessionId = message.sessionId;
    const expected = { runtimeId: message.runtimeId, epoch: message.epoch };
    if (message.type === 'agent.prompt') {
      await this.#executeUserMessageWithContext(message, 'prompt', expected);
    } else if (message.type === 'agent.steer') {
      await this.#executeUserMessageWithContext(message, 'steer', expected);
    } else if (message.type === 'agent.follow-up') {
      await this.#executeUserMessageWithContext(message, 'follow_up', expected);
    } else if (message.type === 'agent.abort') {
      await sessions.execute(sessionId, { type: 'abort' }, expected);
    } else if (message.type === 'agent.compact') {
      await sessions.execute(sessionId, { type: 'compact' }, expected);
    } else if (message.type === 'agent.abort-retry') {
      await sessions.execute(sessionId, { type: 'abort_retry' }, expected);
    } else if (message.type === 'agent.set-model') {
      return {
        thinking: await sessions.executeThinkingControl(
          sessionId,
          {
            type: 'set_model',
            provider: message.payload.provider,
            modelId: message.payload.modelId,
          },
          expected
        ),
      };
    } else if (message.type === 'agent.set-thinking') {
      return {
        thinking: await sessions.executeThinkingControl(
          sessionId,
          {
            type: 'set_thinking_level',
            level: message.payload.level,
          },
          expected
        ),
      };
    } else if (message.type === 'agent.set-work-mode') {
      return {
        planMode: await sessions.executeWorkModeControl(
          sessionId,
          message.payload.mode,
          expected,
          message.payload.knowledge
        ),
      };
    } else if (message.type === 'agent.set-permission-mode') {
      return {
        permission: await sessions.executePermissionControl(sessionId, message.payload.mode, expected),
      };
    } else if (message.type === 'agent.set-queue-mode') {
      await sessions.execute(
        sessionId,
        message.payload.queue === 'steering'
          ? { type: 'set_steering_mode', mode: message.payload.mode }
          : { type: 'set_follow_up_mode', mode: message.payload.mode },
        expected
      );
    } else if (message.type === 'extension.ui.response') {
      const payload = message.payload;
      let response: Parameters<SessionsService['respondToExtensionUi']>[2];
      if (payload.cancelled) {
        response = {
          type: 'extension_ui_response' as const,
          id: payload.extensionRequestId,
          cancelled: true as const,
        };
      } else {
        if (payload.confirmed !== undefined) {
          response = {
            type: 'extension_ui_response' as const,
            id: payload.extensionRequestId,
            confirmed: payload.confirmed,
          };
        } else {
          response = {
            type: 'extension_ui_response' as const,
            id: payload.extensionRequestId,
            value: payload.value ?? '',
          };
        }
      }
      await sessions.respondToExtensionUi(sessionId, expected, response);
    }
    return undefined;
  }

  /**
   * Fans a Session event out only to connections subscribed to that Session.
   */
  #broadcast(event: HostEventEnvelope): void {
    let correlatedEvent = this.#userMessages.correlate(event);
    let hasAuthoritativeAttachments = false;
    if (correlatedEvent.requestId !== undefined && isUserMessageEnd(correlatedEvent)) {
      const attachmentService = this.#dependencies.attachmentsService as AttachmentsService & {
        bindPrompt?: AttachmentsService['bindPrompt'];
        listMessageAttachments?: AttachmentsService['listMessageAttachments'];
      };
      attachmentService.bindPrompt?.(
        correlatedEvent.sessionId,
        correlatedEvent.payload.message.entryId,
        correlatedEvent.requestId
      );
      const attachments = attachmentService
        .listMessageAttachments?.(correlatedEvent.sessionId)
        .get(correlatedEvent.payload.message.entryId);
      if (attachments !== undefined && attachments.length > 0) {
        hasAuthoritativeAttachments = true;
        correlatedEvent = {
          ...correlatedEvent,
          payload: {
            ...correlatedEvent.payload,
            message: { ...correlatedEvent.payload.message, attachments },
          },
        };
      }
    }
    if (isUserMessageEvent(correlatedEvent)) {
      correlatedEvent = {
        ...correlatedEvent,
        payload: {
          ...correlatedEvent.payload,
          message: projectHostVisibleUserMessage(
            correlatedEvent.payload.message,
            hasAuthoritativeAttachments
          ),
        },
      };
    }
    for (const connection of this.#connections.values()) {
      if (connection.sessions.has(event.sessionId)) {
        connection.send(correlatedEvent);
      }
    }
  }

  /**
   * Correlates the durable HTTP submission with Agent events using the same context pipeline as WebSocket.
   */
  public async dispatchFirstMessage(
    message: Extract<ClientRealtimeMessage, { type: 'agent.prompt' }>,
    command: ManagedSessionCommand
  ) {
    this.#userMessages.register(message);
    try {
      const response = await this.#dependencies.sessionsService.execute(message.sessionId, command, message);
      if (!responseSucceeded(response)) {
        throw new SessionRuntimeError('SESSION_RUNTIME_STALE', 'Agent rejected first-message delivery.');
      }
    } catch (error) {
      this.#userMessages.cancel(message.sessionId, message.requestId);
      throw error;
    }
  }

  /**
   * Resolves first-message inputs before the durable acceptance transaction, without executing them.
   */
  public async prepareFirstMessage(message: Extract<ClientRealtimeMessage, { type: 'agent.prompt' }>) {
    let prepared: ManagedSessionCommand | undefined;
    await this.#executeUserMessageWithContext(message, 'prompt', message, (command) => {
      prepared = command;
      return Promise.resolve();
    });
    if (!prepared) {
      throw new Error('First message could not be prepared.');
    }
    return prepared;
  }

  /**
   * Validates Workspace references and adapts attachments for all Pi user-message commands.
   */
  async #executeUserMessageWithContext(
    message: Extract<ClientRealtimeMessage, { type: 'agent.prompt' | 'agent.steer' | 'agent.follow-up' }>,
    commandType: 'prompt' | 'steer' | 'follow_up',
    expected: { runtimeId?: string; epoch?: number },
    prepare?: (command: ManagedSessionCommand) => Promise<void>
  ): Promise<void> {
    const execute = (sessionId: string, command: ManagedSessionCommand, target: typeof expected) =>
      prepare ? prepare(command) : this.#dependencies.sessionsService.execute(sessionId, command, target);
    const ids = message.payload.attachmentIds ?? [];
    const requestedReferences = message.payload.workspaceReferences ?? [];
    const sessions = this.#dependencies.sessionsService;
    if (ids.length === 0 && requestedReferences.length === 0) {
      await execute(message.sessionId, { type: commandType, message: message.payload.message }, expected);
      return;
    }
    const legacyAttachments = this.#dependencies.attachmentsService as AttachmentsService & {
      consume?: (attachmentIds: string[]) => {
        text: string;
        images: Array<{ type: 'image'; data: string; mimeType: string }>;
      };
    };
    const sessionLookup = sessions as SessionsService & {
      getSession?: SessionsService['getSession'];
    };
    if (
      requestedReferences.length === 0 &&
      sessionLookup.getSession === undefined &&
      legacyAttachments.consume !== undefined
    ) {
      const adapted = legacyAttachments.consume(ids);
      await execute(
        message.sessionId,
        {
          type: commandType,
          message: `${message.payload.message}${adapted.text}`,
          ...(adapted.images.length === 0 ? {} : { images: adapted.images }),
        },
        expected
      );
      return;
    }
    const session = sessions.getSession(message.sessionId);
    const references =
      requestedReferences.length === 0
        ? []
        : await this.#dependencies.resolveWorkspaceReferences(session.workspaceId, requestedReferences);
    const referenceSuffix = createWorkspaceReferencePromptSuffix(message.requestId, references);
    if (ids.length === 0) {
      await execute(
        message.sessionId,
        { type: commandType, message: `${message.payload.message}${referenceSuffix}` },
        expected
      );
      return;
    }
    const items = this.#dependencies.attachmentsService.reservePrompt(
      session.workspaceId,
      message.sessionId,
      message.requestId,
      ids
    );
    try {
      const modelInputs = await sessions.getActiveModelInputs(message.sessionId);
      const workspaceCwd = await this.#dependencies.resolveWorkspaceCwd(session.workspaceId);
      const adapted = await this.#dependencies.attachmentDeliveryService.resolveForAgent(items, {
        modelInputs,
        maxInlineCharacters: 100_000,
        ...(session.provider === undefined ? {} : { provider: session.provider }),
        ...(session.model === undefined ? {} : { modelId: session.model }),
        sessionId: message.sessionId,
        workspaceCwd,
        requestId: message.requestId,
        queryText: message.payload.message,
      });
      const requestMarker = ids.length === 0 ? '' : `\n<host_attachment_request id="${message.requestId}" />`;
      const knowledgeSuffix =
        (await this.#dependencies
          .prepareKnowledgeAttachments?.(session.workspaceId, message.sessionId, ids)
          .catch(
            () =>
              '\n<host_knowledge_imports>Knowledge import references are temporarily unavailable. Ordinary attachments remain usable.</host_knowledge_imports>'
          )) ?? '';
      await execute(
        message.sessionId,
        {
          type: commandType,
          message: `${message.payload.message}${referenceSuffix}${requestMarker}${adapted.promptSuffix}${knowledgeSuffix}`,
          ...(adapted.images.length === 0 ? {} : { images: adapted.images }),
        },
        expected
      );
    } catch (error) {
      if (ids.length > 0) {
        this.#dependencies.attachmentsService.releasePrompt(message.requestId);
      }
      throw error;
    }
  }

  /**
   * Resolves an active logical connection or rejects stale transport work.
   */
  #requireConnection(connectionId: string): ChannelConnection {
    const connection = this.#connections.get(connectionId);
    if (connection === undefined) {
      throw new Error('Connection is not registered.');
    }
    return connection;
  }
}

/**
 * Identifies a Pi user-message lifecycle event that requires Host-safe presentation.
 *
 * @param event - Candidate Host event envelope.
 * @returns Whether the envelope carries a user message.
 */
function isUserMessageEvent(
  event: HostEventEnvelope
): event is HostEventEnvelope<{ type: string; message: { role: 'user' } & Record<string, unknown> }> {
  if (event.type !== 'agent.event' || typeof event.payload !== 'object' || event.payload === null) {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  const message = payload['message'];
  return (
    typeof payload['type'] === 'string' &&
    typeof message === 'object' &&
    message !== null &&
    (message as Record<string, unknown>)['role'] === 'user'
  );
}

/**
 * Identifies an enriched authoritative user message end carrying a durable Pi entry id.
 */
function isUserMessageEnd(
  event: HostEventEnvelope
): event is HostEventEnvelope<{ type: 'message_end'; message: { role: 'user'; entryId: string } }> {
  if (event.type !== 'agent.event' || typeof event.payload !== 'object' || event.payload === null) {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  const message = payload['message'];
  return (
    payload['type'] === 'message_end' &&
    typeof message === 'object' &&
    message !== null &&
    (message as Record<string, unknown>)['role'] === 'user' &&
    typeof (message as Record<string, unknown>)['entryId'] === 'string'
  );
}

/**
 * Issue narrow capabilities for original document bytes after the ordinary channel has reserved its attachment list.
 */
export function createKnowledgeAttachmentContext(
  agentDir: string,
  attachments: AttachmentsService,
  sessions: SessionsService
) {
  return async (workspaceId: string, sessionId: string, ids: readonly string[]): Promise<string> => {
    const agentSessionId = await sessions.resolveAgentSessionRef(workspaceId, sessionId);
    const rows: string[] = [];
    for (const id of ids) {
      const original = attachments.describeKnowledgeOriginal(workspaceId, id);
      if (!/\.(docx|xlsx|pptx|csv|md|txt|pdf|zip|tar|gz|tgz)$/iu.test(original.title)) {
        continue;
      }
      const ref = await issueKnowledgeImportTicket(agentDir, {
        ...original,
        workspaceId,
        agentSessionId,
        attachmentId: id,
      });
      rows.push(
        JSON.stringify({ attachmentId: id, name: original.title, knowledge_import_ref: ref })
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
      );
    }
    return rows.length
      ? '\n<host_knowledge_imports>Only use these original-file references with knowledge_import_attachment when the user asks to save attachments to a knowledge collection.\n' +
          rows.join('\n') +
          '\n</host_knowledge_imports>'
      : '';
  };
}

/**
 * 会创建 Pi 权威用户消息，因此需要关联原始请求的命令。
 *
 * `agent.prompt` 在 Agent 空闲时启动任务。
 * `agent.steer`: 立即纠正当前任务方向。执行时机：它会在当前 assistant 回合完成工具调用后、下一次 LLM 调用前送达。
 * `agent.follow-up`: 等当前任务完成后再处理。执行时机：Agent 不再有工具调用或 steering 消息后送达。
 *
 * 这些命令用于追加用户指令
 */
type UserMessageCommand = Extract<
  ClientRealtimeMessage,
  { type: 'agent.prompt' | 'agent.steer' | 'agent.follow-up' }
>;

interface PendingUserMessage {
  requestId: string;
  text: string;
  type: UserMessageCommand['type'];
  active: boolean;
  order: number;
}

const COMMAND_PRIORITY: Record<UserMessageCommand['type'], number> = {
  'agent.prompt': 0,
  'agent.steer': 1,
  'agent.follow-up': 2,
};

/**
 * Checks whether a realtime command will eventually produce a Pi user message.
 *
 * @param message - Validated realtime command.
 * @returns Whether the command participates in user-message correlation.
 */
export function isUserMessageCommand(message: ClientRealtimeMessage): message is UserMessageCommand {
  return (
    message.type === 'agent.prompt' || message.type === 'agent.steer' || message.type === 'agent.follow-up'
  );
}

/**
 * Owns pending transport commands until Pi emits the corresponding user-message lifecycle.
 */
export class UserMessageRequestCorrelator {
  readonly #pendingBySession = new Map<string, PendingUserMessage[]>();
  readonly #requestByMessage = new Map<string, Map<string, string>>();
  #nextOrder = 0;

  /**
   * Registers a command before it crosses into the asynchronous Pi runtime.
   *
   * @param command - Prompt, steer, or follow-up command carrying the client request identity.
   */
  public register(command: UserMessageCommand): void {
    this.cancel(command.sessionId, command.requestId);
    const pending = this.#pendingBySession.get(command.sessionId) ?? [];
    pending.push({
      requestId: command.requestId,
      text: command.payload.message,
      type: command.type,
      active: false,
      order: this.#nextOrder++,
    });
    this.#pendingBySession.set(command.sessionId, pending);
  }

  /**
   * Removes a command whose runtime execution was rejected before a user message was accepted.
   *
   * @param sessionId - Owning Session identity.
   * @param requestId - Rejected transport request identity.
   */
  public cancel(sessionId: string, requestId: string): void {
    const pending = this.#pendingBySession.get(sessionId);
    if (pending === undefined) {
      return;
    }
    const next = pending.filter((candidate) => candidate.requestId !== requestId);
    if (next.length === 0) {
      this.#pendingBySession.delete(sessionId);
    } else {
      this.#pendingBySession.set(sessionId, next);
    }
    const bindings = this.#requestByMessage.get(sessionId);
    if (bindings !== undefined) {
      for (const [messageId, candidateRequestId] of bindings) {
        if (candidateRequestId === requestId) {
          bindings.delete(messageId);
        }
      }
      if (bindings.size === 0) {
        this.#requestByMessage.delete(sessionId);
      }
    }
  }

  /**
   * Adds the originating request identity to one authoritative user-message event.
   *
   * @param event - Session event projected from the Pi runtime.
   * @returns The original envelope or an envelope enriched with its transport request identity.
   */
  public correlate(event: HostEventEnvelope): HostEventEnvelope {
    if (event.type === 'extension.ui' && isRecord(event.payload) && event.payload['method'] === 'notify') {
      const requestId = this.#resolveSlashCommandNotification(event.sessionId);
      return requestId === undefined ? event : { ...event, requestId };
    }
    if (event.type !== 'agent.event' || !isRecord(event.payload)) {
      return event;
    }
    const eventType = typeof event.payload['type'] === 'string' ? event.payload['type'] : '';
    if (eventType === 'agent_settled') {
      this.#clearSession(event.sessionId);
      return event;
    }
    if (eventType !== 'message_start' && eventType !== 'message_end') {
      return event;
    }
    const message = isRecord(event.payload['message']) ? event.payload['message'] : undefined;
    if (message === undefined || message['role'] !== 'user') {
      return event;
    }
    const requestId = this.#resolveRequest(event.sessionId, message, eventType === 'message_end');
    return requestId === undefined ? event : { ...event, requestId };
  }

  /**
   * Releases every pending command and message binding during Channel shutdown.
   */
  public clear(): void {
    this.#pendingBySession.clear();
    this.#requestByMessage.clear();
  }

  /**
   * Completes a pending slash command when its Extension UI notification is emitted.
   *
   * Pi extension commands bypass the Agent message lifecycle, so their RPC notification is the only
   * response event available for correlating and settling the browser's optimistic command row.
   *
   * @param sessionId - Session that emitted the Extension UI notification.
   * @returns Originating prompt request identity when a slash command is pending.
   */
  #resolveSlashCommandNotification(sessionId: string): string | undefined {
    const pending = this.#pendingBySession.get(sessionId) ?? [];
    const command = pending.find(
      (candidate) =>
        candidate.type === 'agent.prompt' && !candidate.active && candidate.text.trimStart().startsWith('/')
    );
    if (command === undefined) {
      return undefined;
    }
    this.cancel(sessionId, command.requestId);
    return command.requestId;
  }

  /**
   * Resolves one Pi user message against an active binding or a pending command.
   *
   * @param sessionId - Owning Session identity.
   * @param message - Pi user message carried by the lifecycle event.
   * @param completed - Whether this event completes the message lifecycle.
   * @returns Correlated transport request identity when one is available.
   */
  #resolveRequest(
    sessionId: string,
    message: Record<string, unknown>,
    completed: boolean
  ): string | undefined {
    const messageId = getMessageId(message);
    const bindings = this.#requestByMessage.get(sessionId);
    let requestId = messageId === undefined ? undefined : bindings?.get(messageId);
    const pending = this.#pendingBySession.get(sessionId) ?? [];
    if (requestId === undefined && completed) {
      requestId = this.#findActiveRequest(pending, getMessageText(message));
    }
    if (requestId === undefined) {
      requestId = this.#activatePending(pending, getMessageText(message));
    }
    if (requestId === undefined) {
      return undefined;
    }
    if (messageId !== undefined && !completed) {
      const nextBindings = bindings ?? new Map<string, string>();
      nextBindings.set(messageId, requestId);
      this.#requestByMessage.set(sessionId, nextBindings);
    }
    if (completed) {
      this.cancel(sessionId, requestId);
    }
    return requestId;
  }

  /**
   * Finds an already-started request when Pi completes a message with a different or absent identity.
   *
   * @param pending - Pending commands for one Session.
   * @param text - Normalized authoritative user text.
   * @returns Active request identity when one matches.
   */
  #findActiveRequest(pending: PendingUserMessage[], text: string): string | undefined {
    return pending.find((candidate) => candidate.active && matchesPromptText(candidate.text, text))
      ?.requestId;
  }

  /**
   * Selects the next pending command according to Pi prompt and queue execution semantics.
   *
   * @param pending - Pending commands for one Session.
   * @param text - Normalized authoritative user text.
   * @returns Newly activated request identity when one matches.
   */
  #activatePending(pending: PendingUserMessage[], text: string): string | undefined {
    const candidates = pending.filter(
      (candidate) => !candidate.active && (text === '' || matchesPromptText(candidate.text, text))
    );
    candidates.sort(
      (left, right) => COMMAND_PRIORITY[left.type] - COMMAND_PRIORITY[right.type] || left.order - right.order
    );
    const candidate = candidates[0];
    if (candidate === undefined) {
      return undefined;
    }
    candidate.active = true;
    return candidate.requestId;
  }

  /**
   * Drops stale Session correlation state after Pi reports that no queued work can continue.
   *
   * @param sessionId - Settled Session identity.
   */
  #clearSession(sessionId: string): void {
    this.#pendingBySession.delete(sessionId);
    this.#requestByMessage.delete(sessionId);
  }
}

/**
 * Matches the original browser prompt with the Pi message after server-side file blocks are appended.
 */
function matchesPromptText(original: string, projected: string): boolean {
  return (
    projected === original ||
    projected.startsWith(`${original}\n\n<file name="`) ||
    projected.startsWith(`${original}\n<host_attachment_request id="`) ||
    projected.startsWith(`${original}\n<host_workspace_reference_request id="`)
  );
}

/**
 * Checks whether an unknown value is an object record.
 *
 * @param value - Unknown value.
 * @returns Whether string-keyed fields can be read safely.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extracts the stable identity shared by Pi message_start and message_end events.
 *
 * @param message - Pi message object.
 * @returns Stable message identity when supplied by Pi.
 */
function getMessageId(message: Record<string, unknown>): string | undefined {
  const value = message['id'] ?? message['timestamp'];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

/**
 * Normalizes the text content used to associate Pi messages with accepted commands.
 *
 * @param message - Pi message object.
 * @returns Concatenated user text in content-block order.
 */
function getMessageText(message: Record<string, unknown>): string {
  const content = message['content'];
  if (typeof content === 'string') {
    return content;
  }
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .filter(isRecord)
    .filter((block) => block['type'] === 'text')
    .map((block) => (typeof block['text'] === 'string' ? block['text'] : ''))
    .join('');
}
