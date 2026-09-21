/**
 * @author Codex
 * @description Tracks one managed Session runtime state machine and every observable safe-reclamation gate.
 */

import { projectBackgroundTasks } from '@octopus/shared/protocol';
import type {
  JsonAgentSessionEvent,
  RpcExtensionUIRequest,
  RpcSessionState,
} from '@earendil-works/pi-coding-agent';
import type { SessionRuntimeState } from './types.js';

type ManagedRuntimeEvent = JsonAgentSessionEvent | RpcExtensionUIRequest;

/**
 * Concentrates Pi event projection and reclaimability invariants for one runtime.
 */
export class ManagedRuntimeState {
  readonly #pendingExtensionUiIds = new Set<string>();
  #state: SessionRuntimeState;
  #settled: boolean;
  #streaming: boolean;
  #compacting: boolean;
  #pendingMessageCount: number;
  #backgroundWork = false;

  /**
   * Initializes safety state from the authoritative Pi readiness snapshot.
   */
  public constructor(state: RpcSessionState) {
    this.#state = state.isStreaming || state.isCompacting ? 'running' : 'idle';
    this.#settled = !state.isStreaming && !state.isCompacting && state.pendingMessageCount === 0;
    this.#streaming = state.isStreaming;
    this.#compacting = state.isCompacting;
    this.#pendingMessageCount = state.pendingMessageCount;
  }

  /**
   * Returns the current Host-facing runtime state.
   */
  public getState(): SessionRuntimeState {
    return this.#state;
  }

  /**
   * Applies a Host lifecycle state and invalidates settled status when required.
   */
  public markState(state: Extract<SessionRuntimeState, 'recovering' | 'failed' | 'stopping'>): void {
    this.#state = state;
    if (state === 'recovering') {
      this.#settled = false;
      this.#backgroundWork = false;
    }
  }

  /**
   * Applies a Pi state snapshot after readiness or explicit state queries.
   * @param state Authoritative Pi runtime state
   * @param confirmSettled Whether an idle readiness snapshot proves safe settled state
   */
  public applySnapshot(state: RpcSessionState, confirmSettled = false): void {
    this.#streaming = state.isStreaming;
    this.#compacting = state.isCompacting;
    this.#pendingMessageCount = state.pendingMessageCount;
    if (state.isStreaming || state.isCompacting || state.pendingMessageCount > 0) {
      this.#settled = false;
    } else if (confirmSettled) {
      this.#settled = true;
    }
    this.#state =
      state.isStreaming || state.isCompacting || state.pendingMessageCount > 0 ? 'running' : 'idle';
  }

  /**
   * Applies one Pi event and returns whether the Host-facing state changed.
   */
  public applyEvent(event: ManagedRuntimeEvent): boolean {
    const background = projectBackgroundTasks(event);
    if (background !== undefined) {
      this.#backgroundWork = background === null || background.activeCount > 0 || !background.accepting;
    }
    const previousState = this.#state;
    if (event.type === 'agent_start') {
      this.#streaming = true;
      this.#settled = false;
      this.#state = 'running';
    } else if (event.type === 'agent_settled') {
      this.#streaming = false;
      this.#compacting = false;
      this.#pendingMessageCount = 0;
      this.#settled = true;
      this.#state = 'idle';
    } else if (event.type === 'compaction_start') {
      this.#compacting = true;
      this.#settled = false;
      this.#state = 'running';
    } else if (event.type === 'compaction_end') {
      this.#compacting = false;
      if (!this.#streaming && this.#pendingMessageCount === 0) {
        this.#settled = true;
        this.#state = 'idle';
      }
    } else if (event.type === 'queue_update') {
      this.#pendingMessageCount = event.steering.length + event.followUp.length;
      if (this.#pendingMessageCount > 0) {
        this.#settled = false;
        this.#state = 'running';
      }
    } else if (
      event.type === 'extension_ui_request' &&
      (event.method === 'select' ||
        event.method === 'confirm' ||
        event.method === 'input' ||
        event.method === 'editor')
    ) {
      this.#pendingExtensionUiIds.add(event.id);
    }
    return this.#state !== previousState;
  }

  /**
   * Confirms whether this runtime owns a pending Extension UI request.
   */
  public hasExtensionUi(extensionRequestId: string): boolean {
    return this.#pendingExtensionUiIds.has(extensionRequestId);
  }

  /**
   * Resolves a pending Extension UI request after the process accepts its response.
   */
  public resolveExtensionUi(extensionRequestId: string): void {
    this.#pendingExtensionUiIds.delete(extensionRequestId);
  }

  /**
   * Invalidates UI requests owned by a terminated Agent process generation.
   */
  public clearExtensionUi(): void {
    this.#pendingExtensionUiIds.clear();
  }

  /**
   * Evaluates all state-machine gates used for safe idle reclamation.
   */
  public isSafelyReclaimable(processReady: boolean, inFlight: boolean, lifecycleMutation: boolean): boolean {
    return (
      this.#state === 'idle' &&
      this.#settled &&
      !this.#streaming &&
      !this.#compacting &&
      this.#pendingMessageCount === 0 &&
      this.#pendingExtensionUiIds.size === 0 &&
      !this.#backgroundWork &&
      !inFlight &&
      !lifecycleMutation &&
      processReady
    );
  }
}
