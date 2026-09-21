/**
 * @author Codex
 * @description Projects internal Session runtime bindings, responses, and events onto transport-safe state.
 */
import { projectMemoryState } from './memory-state-projection.js';
import { projectBackgroundTasks } from '@octopus/shared/protocol';

import { parseKnowledgeModeState } from '@octopus/shared/protocol/knowledge';
import { RpivQuestionnaireAdapter } from './rpiv-questionnaire-adapter.js';
import { PlanModeQuestionnaireAdapter } from './plan-mode-questionnaire-adapter.js';
import { projectSubagentFleetPayload } from './subagent-fleet-projection.js';
import type { BackgroundTasksSnapshot } from '@octopus/shared/protocol';
import type { MemoryRuntimeSnapshot } from '@octopus/shared/protocol/memory';
import type { KnowledgeModeState } from '@octopus/shared/protocol/knowledge';
import type {
  ActiveAutoRetryDto,
  HostEventEnvelope,
  SubagentFleetSnapshotDto,
} from '@octopus/shared/protocol';
import type { SessionRuntimeCoordinator } from './coordinator.js';
import type { HostAgentEvent } from './types.js';
import type { RpcExtensionUIResponse } from '@earendil-works/pi-coding-agent';

export interface RuntimeEventProjectionOptions {
  /**
   * Runs before listeners receive a normalized message lifecycle event.
   */
  onMessageActivity?: (sessionId: string, timestamp: string) => void;
}

/**
 * Owns the Session event projection lifecycle behind one subscription to the managed runtime library.
 */
export class RuntimeEventProjection {
  readonly #listeners = new Set<(event: HostEventEnvelope) => void>();
  readonly #pendingExtensionUi = new Map<string, HostEventEnvelope[]>();
  readonly #activeRetries = new Map<string, ActiveAutoRetryDto>();
  readonly #subagentFleet = new Map<string, SubagentFleetSnapshotDto>();
  readonly #backgroundTasks = new Map<string, BackgroundTasksSnapshot | null>();
  readonly #memory = new Map<string, MemoryRuntimeSnapshot>();
  readonly #knowledgeMode = new Map<string, KnowledgeModeState>();
  readonly #planModeAvailable = new Set<string>();
  readonly #lastSequence = new Map<string, number>();
  readonly #questionnaires = new RpivQuestionnaireAdapter();
  readonly #planQuestionnaires = new PlanModeQuestionnaireAdapter();
  readonly #onMessageActivity: NonNullable<RuntimeEventProjectionOptions['onMessageActivity']>;
  readonly #unsubscribe: () => void;

  /**
   * Subscribes once to managed runtime events for the lifetime of this projection.
   */
  public constructor(runtime: SessionRuntimeCoordinator, options: RuntimeEventProjectionOptions = {}) {
    this.#onMessageActivity = options.onMessageActivity ?? (() => undefined);
    this.#unsubscribe = runtime.onEvent((event) => this.#publish(event));
  }

  /**
   * Subscribes a caller to normalized Session Host events.
   */
  public onEvent(listener: (event: HostEventEnvelope) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Returns the latest sequence observed for one Session.
   */
  public getSequence(sessionId: string): number {
    return this.#lastSequence.get(sessionId) ?? 0;
  }

  /**
   * Returns pending interactive Extension UI envelopes for one Session.
   */
  public getPendingExtensionUi(sessionId: string): HostEventEnvelope[] {
    return this.#pendingExtensionUi.get(sessionId) ?? [];
  }

  /**
   * Returns the latest validated auto-retry wait state for reconnect recovery.
   *
   * @param sessionId Stable Web Session identity.
   * @returns Active retry metadata while Pi is retrying, otherwise undefined.
   */
  public getActiveRetry(sessionId: string): ActiveAutoRetryDto | undefined {
    return this.#activeRetries.get(sessionId);
  }

  /**
   * Returns the latest validated pi-subagents Fleet snapshot for one Session.
   */
  public getSubagentFleet(sessionId: string): SubagentFleetSnapshotDto | undefined {
    return this.#subagentFleet.get(sessionId);
  }

  /**
   * Null denotes a matching but invalid observation and must fail stop verification.
   */
  public getBackgroundTasks(sessionId: string): BackgroundTasksSnapshot | null | undefined {
    return this.#backgroundTasks.get(sessionId);
  }

  /**
   * Return the current runtime's last validated memory observation for reconnect snapshots.
   *
   * @param sessionId Stable Web Session identity.
   * @returns Memory observation, or undefined before the extension announces its state.
   */
  public getMemory(sessionId: string): MemoryRuntimeSnapshot | undefined {
    return this.#memory.get(sessionId);
  }

  /**
   * Return the last validated knowledge mode for the current runtime.
   */
  public getKnowledgeMode(sessionId: string): KnowledgeModeState | undefined {
    return this.#knowledgeMode.get(sessionId);
  }

  /**
   * Report pinned Plan availability independently of knowledge mode.
   */
  public isPlanModeAvailable(sessionId: string): boolean {
    return this.#planModeAvailable.has(sessionId);
  }

  /**
   * Reconciles Plan availability from Pi's authoritative command catalog.
   *
   * @param sessionId Stable Web Session identity.
   * @param available Whether the current runtime exposes the Plan extension command.
   */
  public setPlanModeAvailable(sessionId: string, available: boolean): void {
    if (available) {
      this.#planModeAvailable.add(sessionId);
      return;
    }
    this.#planModeAvailable.delete(sessionId);
  }

  /**
   * Removes one Extension UI request after its exact runtime accepts a response.
   */
  public resolveExtensionUi(sessionId: string, response: RpcExtensionUIResponse): void {
    const pending = this.#pendingExtensionUi.get(sessionId) ?? [];
    this.#pendingExtensionUi.set(
      sessionId,
      pending.filter((event) => (event.payload as { id?: string }).id !== response.id)
    );
    this.#questionnaires.resolve(sessionId, response);
    this.#planQuestionnaires.resolve(sessionId, response);
  }

  /**
   * Releases the runtime subscription and every in-memory projection.
   */
  public close(): void {
    this.#unsubscribe();
    this.#listeners.clear();
    this.#pendingExtensionUi.clear();
    this.#activeRetries.clear();
    this.#subagentFleet.clear();
    this.#backgroundTasks.clear();
    this.#planModeAvailable.clear();
    this.#knowledgeMode.clear();
    this.#memory.clear();
    this.#lastSequence.clear();
    this.#questionnaires.close();
    this.#planQuestionnaires.close();
  }

  /**
   * Normalizes one managed-runtime event and updates Session projection state.
   */
  #publish(event: HostAgentEvent): void {
    if (event.type === 'runtime-state' && isRecoveringState(event.payload)) {
      this.#knowledgeMode.delete(event.sessionId);
      this.#memory.delete(event.sessionId);
      this.#pendingExtensionUi.delete(event.sessionId);
      this.#activeRetries.delete(event.sessionId);
      this.#subagentFleet.delete(event.sessionId);
      this.#backgroundTasks.delete(event.sessionId);
      this.#questionnaires.reset(event.sessionId);
      this.#planQuestionnaires.reset(event.sessionId);
    }
    if (
      event.type === 'extension-ui' &&
      isRecord(event.payload) &&
      event.payload['method'] === 'setStatus' &&
      event.payload['statusKey'] === 'octopus-knowledge-mode'
    ) {
      try {
        const state = parseKnowledgeModeState(JSON.parse(String(event.payload['statusText'])));
        if (state) {
          this.#knowledgeMode.set(event.sessionId, state);
        }
      } catch {
        /* Ignore malformed extension projections. */
      }
    }
    const memory = event.type === 'extension-ui' ? projectMemoryState(event.payload) : undefined;
    const backgroundTasks = event.type === 'extension-ui' ? projectBackgroundTasks(event.payload) : undefined;
    if (backgroundTasks !== undefined) {
      this.#backgroundTasks.set(event.sessionId, backgroundTasks);
    }
    if (memory) {
      this.#memory.set(event.sessionId, memory);
    }
    this.#projectActiveRetry(event);
    this.#questionnaires.observe(event);
    this.#planQuestionnaires.observe(event);
    if (event.type === 'extension-ui' && isPlanModeStatusRequest(event.payload)) {
      this.#planModeAvailable.add(event.sessionId);
    }
    const subagentProjection =
      event.type === 'extension-ui'
        ? projectSubagentFleetPayload(event.payload)
        : { kind: 'unmatched' as const };
    const type: HostEventEnvelope['type'] =
      subagentProjection.kind === 'snapshot'
        ? 'subagents.state'
        : event.type === 'agent-event'
          ? 'agent.event'
          : event.type === 'extension-ui'
            ? 'extension.ui'
            : event.type === 'runtime-state'
              ? 'agent.state'
              : 'agent.lifecycle';
    const payload =
      subagentProjection.kind === 'snapshot'
        ? (subagentProjection.snapshot ?? null)
        : type === 'extension.ui'
          ? this.#planQuestionnaires.project({
              ...event,
              payload: this.#questionnaires.project(event),
            })
          : event.payload;
    const envelope: HostEventEnvelope = {
      ...event,
      ...(backgroundTasks !== undefined ? { backgroundTasks } : {}),
      type,
      payload,
      ...(memory
        ? { memory }
        : event.type === 'runtime-state' && isRecoveringState(event.payload)
          ? { memory: null }
          : {}),
    };
    if (subagentProjection.kind === 'snapshot') {
      if (subagentProjection.snapshot === undefined) {
        this.#subagentFleet.delete(event.sessionId);
      } else {
        this.#subagentFleet.set(event.sessionId, subagentProjection.snapshot);
      }
    }
    this.#lastSequence.set(event.sessionId, event.sequence);
    if (type === 'agent.event' && this.#isMessageEvent(event.payload)) {
      this.#onMessageActivity(event.sessionId, event.timestamp);
    }
    if (type === 'extension.ui') {
      const payload = event.payload as { method?: string };
      if (
        payload.method === 'select' ||
        payload.method === 'confirm' ||
        payload.method === 'input' ||
        payload.method === 'editor'
      ) {
        const pending = this.#pendingExtensionUi.get(event.sessionId) ?? [];
        this.#pendingExtensionUi.set(event.sessionId, [...pending, envelope]);
      }
    }
    for (const listener of this.#listeners) {
      listener(envelope);
    }
  }

  /**
   * Caches only the active retry episode because completed history is reconstructed from durable messages.
   *
   * @param event Candidate managed-runtime event.
   */
  #projectActiveRetry(event: HostAgentEvent): void {
    if (event.type !== 'agent-event' || !isRecord(event.payload)) {
      return;
    }
    const type = event.payload['type'];
    if (type === 'auto_retry_end' || type === 'agent_settled') {
      this.#activeRetries.delete(event.sessionId);
      return;
    }
    if (
      type === 'message_start' &&
      isRecord(event.payload['message']) &&
      event.payload['message']['role'] === 'assistant'
    ) {
      const activeRetry = this.#activeRetries.get(event.sessionId);
      if (activeRetry !== undefined) {
        this.#activeRetries.set(event.sessionId, { ...activeRetry, phase: 'retrying' });
      }
      return;
    }
    if (type !== 'auto_retry_start') {
      return;
    }
    const attempt = event.payload['attempt'];
    const maxAttempts = event.payload['maxAttempts'];
    const delayMs = event.payload['delayMs'];
    const errorMessage = event.payload['errorMessage'];
    if (
      typeof attempt !== 'number' ||
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      typeof maxAttempts !== 'number' ||
      !Number.isInteger(maxAttempts) ||
      maxAttempts < attempt ||
      typeof delayMs !== 'number' ||
      !Number.isFinite(delayMs) ||
      delayMs < 0 ||
      typeof errorMessage !== 'string' ||
      errorMessage.trim().length === 0
    ) {
      return;
    }
    this.#activeRetries.set(event.sessionId, {
      phase: 'waiting',
      attempt,
      maxAttempts,
      delayMs,
      errorMessage: errorMessage.trim(),
      scheduledAt: event.timestamp,
    });
  }

  /**
   * Checks whether a Pi agent event payload represents a chat message lifecycle event.
   */
  #isMessageEvent(payload: unknown): boolean {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      ['message_start', 'message_update', 'message_end'].includes(
        String((payload as Record<string, unknown>).type)
      )
    );
  }
}

/**
 * Detects recovery boundaries that invalidate process-owned pending dialogs.
 *
 * @param payload Runtime state payload.
 * @returns Whether a new process generation is being established.
 */
function isRecoveringState(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as Record<string, unknown>)['state'] === 'recovering'
  );
}

/**
 * Narrows unknown runtime payloads before retry fields are inspected.
 *
 * @param value Unknown runtime payload.
 * @returns Whether the payload is a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Detects the stable status key emitted by pi-plan-mode 0.55.3 during every Session start.
 *
 * @param payload Candidate RPC Extension UI request.
 * @returns Whether it proves the Plan extension is loaded for this runtime generation.
 */
function isPlanModeStatusRequest(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as Record<string, unknown>)['method'] === 'setStatus' &&
    (payload as Record<string, unknown>)['statusKey'] === 'plan-mode'
  );
}
