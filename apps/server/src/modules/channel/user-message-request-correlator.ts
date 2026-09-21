/**
 * @author Codex
 * @description Channel 协议的双向关联组件：把入站 Web 请求与出站 Pi 投影事件关联起来
 */

import type { ClientRealtimeMessage, HostEventEnvelope } from '@octopus/shared/protocol';

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
