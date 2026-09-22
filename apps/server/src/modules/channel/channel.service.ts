/**
 * @author Codex
 * @description Orchestrates logical Session channel subscriptions, commands, and event fan-out from the shared Server context.
 */

import { OCTOPUS_PROTOCOL_VERSION } from '@octopus/shared/protocol';
import { isUserMessageCommand, UserMessageRequestCorrelator } from './user-message-request-correlator.js';
import { MutationIdempotencyLedger, mutationFingerprint } from '../../lib/idempotency/mutation-ledger.js';
import { SessionRuntimeError } from '../../lib/runtime/errors.js';
import { responseSucceeded } from '../../lib/runtime/utils.js';
import { projectHostVisibleUserMessage } from './host-user-message-projection.js';
import { createWorkspaceReferencePromptSuffix } from './workspace-reference-context.js';
import type { AttachmentsService } from '../attachments/attachments.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type {
  ClientRealtimeMessage,
  HostEventEnvelope,
  PermissionStateDto,
  PlanModeStateDto,
  ServerRealtimeMessage,
  ThinkingStateDto,
  WorkspaceReferenceDto,
} from '@octopus/shared/protocol';
import type { ManagedSessionCommand } from '../../lib/runtime/index.js';
import type { FastifyInstance } from 'fastify';

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
  public constructor(
    protected readonly server: FastifyInstance,
    dependencies: ChannelServiceDependencies,
    options: ChannelServiceOptions
  ) {
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
      const response = payload.cancelled
        ? { type: 'extension_ui_response' as const, id: payload.extensionRequestId, cancelled: true as const }
        : payload.confirmed !== undefined
          ? {
              type: 'extension_ui_response' as const,
              id: payload.extensionRequestId,
              confirmed: payload.confirmed,
            }
          : {
              type: 'extension_ui_response' as const,
              id: payload.extensionRequestId,
              value: payload.value ?? '',
            };
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
      const adapted = await this.#dependencies.attachmentsService.resolveForAgent(items, {
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
