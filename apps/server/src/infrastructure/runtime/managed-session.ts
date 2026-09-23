/**
 * @author Codex
 * @description Owns one immutable Session runtime process generation, command safety, recovery, state, and Host events.
 */

import { assertReadinessIdentity, requireRpcState } from './validator.js';
import { ManagedRuntimeState } from './managed-state.js';
import { createRuntimePermissionState, setRuntimePermissionMode } from './permission-control.js';
import { SessionRuntimeError } from './errors.js';
import { getErrorMessage } from '../../utils/value-utils.js';
import type { AgentProcessManager, AgentRpcProcess } from '@octopus/agent/rpc';
import type { RpcExtensionUIResponse, RpcSessionState } from '@earendil-works/pi-coding-agent';
import type { HostAgentEvent, ManagedSessionCommand, SessionRuntimeBinding } from './types.js';
import type { PermissionMode, PermissionStateDto } from '@octopus/shared/protocol';

const REPLACEMENT_COMMANDS = new Set(['switch_session', 'new_session', 'fork', 'clone']);

export interface ManagedSessionRuntimeOptions {
  configRevision?: number;
  /**
   * Signals that task, interaction and lease safety gates may now permit a deferred restart.
   */
  onReclaimable?(): void;
  binding: Omit<SessionRuntimeBinding, 'state' | 'lastActiveAt'>;
  process: AgentRpcProcess;
  state: RpcSessionState;
  manager: AgentProcessManager;
  now: () => number;
  publish: (event: HostAgentEvent) => void;
}

/**
 * Encapsulates every mutable fact belonging to one Host-owned Pi runtime.
 */
export class ManagedSessionRuntime {
  public readonly configRevision: number;
  #suspended = false;
  readonly #binding: Omit<SessionRuntimeBinding, 'state' | 'lastActiveAt'>;
  readonly #manager: AgentProcessManager;
  readonly #now: () => number;
  readonly #publish: (event: HostAgentEvent) => void;
  readonly #runtimeState: ManagedRuntimeState;
  #process: AgentRpcProcess;
  #processGeneration = 1;
  #permissionMode: PermissionMode = 'ask';
  #lastActiveAt: number;
  #sequence = 0;
  #operationLeases = 0;
  #inFlightRequests = 0;
  #lifecycleMutations = 0;
  readonly #drainWaiters = new Set<() => void>();
  #recoveryPromise: Promise<void> | undefined;
  #unsubscribeEvent = (): void => undefined;
  #unsubscribeLifecycle = (): void => undefined;
  #active = false;
  readonly #observers = new Set<() => void>();
  readonly #onReclaimable: () => void;

  /**
   * Creates mutable state for one ready process without publishing it before Coordinator indexes exist.
   */
  public constructor(options: ManagedSessionRuntimeOptions) {
    this.configRevision = options.configRevision ?? 0;
    this.#onReclaimable = () => options.onReclaimable?.();
    this.#binding = options.binding;
    this.#process = options.process;
    this.#manager = options.manager;
    this.#now = options.now;
    this.#publish = options.publish;
    this.#runtimeState = new ManagedRuntimeState(options.state);
    this.#lastActiveAt = options.now();
  }

  /**
   * Activates event subscriptions after the Coordinator publishes identity indexes.
   */
  public start(): void {
    this.#active = true;
    this.#bindProcess(this.#process, this.#processGeneration);
    this.#emit('runtime-state', { state: this.#runtimeState.getState() });
  }

  /**
   * Returns an immutable runtime identity and state snapshot.
   */
  public getBinding(): SessionRuntimeBinding {
    return { ...this.#binding, state: this.#runtimeState.getState(), lastActiveAt: this.#lastActiveAt };
  }

  /**
   * Observes state and task evidence without repeatedly querying the Agent.
   */
  public onChange(listener: () => void): () => void {
    this.#observers.add(listener);
    return () => {
      this.#observers.delete(listener);
    };
  }

  /**
   * Pins this runtime generation for one complete Session-scoped business operation.
   *
   * @returns An idempotent release callback.
   */
  public acquireOperation(): () => void {
    this.#assertAcceptingOperations();
    this.#operationLeases += 1;
    this.#lastActiveAt = this.#now();
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#operationLeases -= 1;
      this.#lastActiveAt = this.#now();
      this.#notifyDrained();
    };
  }

  /**
   * Executes an allowed command and tracks all safety gates used by capacity reclamation.
   */
  public async execute(command: ManagedSessionCommand): Promise<unknown> {
    if (REPLACEMENT_COMMANDS.has(command.type)) {
      throw new SessionRuntimeError(
        'SESSION_REPLACEMENT_FORBIDDEN',
        `Managed runtime cannot execute ${command.type}.`
      );
    }
    this.#assertAcceptingOperations();
    this.#inFlightRequests += 1;
    const mutatesLifecycle = command.type === 'compact';
    if (mutatesLifecycle) {
      this.#lifecycleMutations += 1;
    }
    try {
      await this.#ensureReady();
      this.#lastActiveAt = this.#now();
      const response = await this.#process.execute(command);
      if (command.type === 'get_state' && response.command === 'get_state') {
        const previousState = this.#runtimeState.getState();
        this.#runtimeState.applySnapshot(response.data);
        if (this.#runtimeState.getState() !== previousState) {
          this.#emit('runtime-state', { state: this.#runtimeState.getState() });
        }
      }
      return response;
    } finally {
      this.#inFlightRequests -= 1;
      if (mutatesLifecycle) {
        this.#lifecycleMutations -= 1;
      }
      this.#lastActiveAt = this.#now();
      this.#notifyDrained();
    }
  }

  /**
   * Routes an Extension UI response only when this runtime owns the pending request.
   */
  public async respondToExtensionUi(response: RpcExtensionUIResponse): Promise<void> {
    this.#assertAcceptingOperations();
    this.#inFlightRequests += 1;
    try {
      await this.#ensureReady();
      if (!this.#runtimeState.hasExtensionUi(response.id)) {
        throw new SessionRuntimeError(
          'SESSION_EXTENSION_UI_NOT_FOUND',
          `Extension UI request does not belong to runtime ${this.#binding.runtimeId}: ${response.id}`
        );
      }
      await this.#process.respondToExtensionUi(response);
      this.#runtimeState.resolveExtensionUi(response.id);
    } finally {
      this.#inFlightRequests -= 1;
      this.#lastActiveAt = this.#now();
      this.#notifyDrained();
    }
  }

  /**
   * Reads the permission state owned by the current Agent process generation.
   */
  public async getPermissionState(): Promise<PermissionStateDto> {
    this.#assertAcceptingOperations();
    await this.#ensureReady();
    return createRuntimePermissionState(this.#permissionMode);
  }

  /**
   * Updates permission state in the current Agent process generation.
   *
   * @param mode Requested permission mode.
   */
  public async setPermissionMode(mode: PermissionMode): Promise<PermissionStateDto> {
    this.#assertAcceptingOperations();
    await this.#ensureReady();
    const permission = await setRuntimePermissionMode(this.#process, mode);
    this.#permissionMode = permission.mode;
    return permission;
  }

  /**
   * Waits until every operation and RPC request settles, bounded by the shutdown policy.
   *
   * @param timeoutMs Maximum graceful drain duration.
   * @returns Whether the runtime drained before the timeout elapsed.
   */
  public async waitForDrain(timeoutMs: number): Promise<boolean> {
    if (this.#isDrained()) {
      return true;
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (drained: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.#drainWaiters.delete(onDrained);
        resolve(drained);
      };
      const onDrained = (): void => finish(true);
      const timeout = setTimeout(() => finish(false), timeoutMs);
      timeout.unref?.();
      this.#drainWaiters.add(onDrained);
    });
  }

  /**
   * Marks the runtime as stopping before the process supervisor begins teardown.
   */
  public beginStop(): boolean {
    if (this.#runtimeState.getState() === 'stopping') {
      return false;
    }
    this.#runtimeState.markState('stopping');
    this.#emit('runtime-state', { state: this.#runtimeState.getState() });
    return true;
  }

  /**
   * Atomically claims this runtime for capacity reclamation when every safety gate still holds.
   */
  public tryBeginReclaim(): boolean {
    if (!this.isSafelyReclaimable()) {
      return false;
    }
    return this.beginStop();
  }

  /**
   * Disables generation callbacks and releases process event subscriptions.
   */
  public dispose(): void {
    this.#active = false;
    this.#observers.clear();
    this.#unsubscribeEvent();
    this.#unsubscribeLifecycle();
  }

  /**
   * Returns whether every observable runtime safety gate permits idle reclamation.
   */
  public isSafelyReclaimable(): boolean {
    return this.#runtimeState.isSafelyReclaimable(
      this.#process.getState() === 'ready',
      this.#inFlightRequests > 0 || this.#operationLeases > 0,
      this.#lifecycleMutations > 0
    );
  }

  /**
   * Suspends new RPC work while the lifecycle owner drains previously accepted operations.
   */
  public suspendOperations(): void {
    this.#suspended = true;
  }

  /**
   * Reopens a runtime when restart preflight is rejected without stopping the process.
   */
  public resumeOperations(): void {
    this.#suspended = false;
  }

  /**
   * Resolves graceful-drain waiters after the final protected unit of work settles.
   */
  #notifyDrained(): void {
    if (!this.#isDrained()) {
      return;
    }
    if (this.#active && !this.#suspended && this.isSafelyReclaimable()) {
      this.#onReclaimable();
    }
    for (const waiter of [...this.#drainWaiters]) {
      waiter();
    }
  }

  /**
   * Returns whether teardown can proceed without interrupting accepted work.
   */
  #isDrained(): boolean {
    return this.#operationLeases === 0 && this.#inFlightRequests === 0 && this.#lifecycleMutations === 0;
  }

  /**
   * Rejects operations that race with an already claimed retirement.
   */
  #assertAcceptingOperations(): void {
    if (!this.#active || this.#suspended || this.#runtimeState.getState() === 'stopping') {
      throw new SessionRuntimeError(
        'SESSION_RUNTIME_STALE',
        `Session runtime is no longer accepting operations: ${this.#binding.runtimeId}`
      );
    }
  }

  /**
   * Recovers a failed process once and restores its immutable Session identity.
   */
  async #ensureReady(): Promise<void> {
    if (this.#process.getState() === 'ready') {
      return;
    }
    if (this.#recoveryPromise !== undefined) {
      return this.#recoveryPromise;
    }
    const recovery = this.#recover().finally(() => {
      if (this.#recoveryPromise === recovery) {
        this.#recoveryPromise = undefined;
      }
    });
    this.#recoveryPromise = recovery;
    return recovery;
  }

  /**
   * Performs one process-generation recovery and readiness identity check.
   */
  async #recover(): Promise<void> {
    this.#runtimeState.markState('recovering');
    this.#runtimeState.clearExtensionUi();
    this.#emit('runtime-state', { state: this.#runtimeState.getState() });
    try {
      const process = await this.#manager.ensureReady(this.#binding.runtimeId);
      const state = requireRpcState(process.getLastSessionState(), this.#binding.runtimeId);
      await assertReadinessIdentity(state, this.#binding.agentSessionId, this.#binding.sessionPath);
      this.#permissionMode = 'ask';
      const permission = createRuntimePermissionState(this.#permissionMode);
      this.#processGeneration += 1;
      this.#bindProcess(process, this.#processGeneration);
      this.#runtimeState.applySnapshot(state, true);
      this.#emit('runtime-state', {
        state: this.#runtimeState.getState(),
        processGeneration: this.#processGeneration,
        permission,
      });
    } catch (error) {
      this.#runtimeState.markState('failed');
      this.#emit('error', {
        code: 'SESSION_RUNTIME_RECOVERY_FAILED',
        message: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Binds events to the current process generation and rejects all stale callbacks.
   */
  #bindProcess(process: AgentRpcProcess, generation: number): void {
    this.#unsubscribeEvent();
    this.#unsubscribeLifecycle();
    this.#process = process;
    this.#unsubscribeEvent = process.onEvent((event) => this.#handleProcessEvent(process, generation, event));
    this.#unsubscribeLifecycle = process.onLifecycle((event) => {
      if (!this.#isCurrent(process, generation) || event.type !== 'unexpected-exit') {
        return;
      }
      this.#runtimeState.markState('recovering');
      this.#runtimeState.clearExtensionUi();
      this.#emit('runtime-state', { state: this.#runtimeState.getState() });
      this.#emit('error', { code: event.error.code, message: event.error.message });
    });
  }

  /**
   * Projects one Pi event into managed runtime safety state and a Host event.
   */
  #handleProcessEvent(
    process: AgentRpcProcess,
    generation: number,
    event: Parameters<Parameters<AgentRpcProcess['onEvent']>[0]>[0]
  ): void {
    if (!this.#isCurrent(process, generation)) {
      return;
    }
    this.#lastActiveAt = this.#now();
    if (this.#runtimeState.applyEvent(event)) {
      this.#emit('runtime-state', { state: this.#runtimeState.getState() });
    }
    this.#emit(event.type === 'extension_ui_request' ? 'extension-ui' : 'agent-event', event);
    this.#notifyDrained();
  }

  /**
   * Checks active ownership of the current process generation.
   */
  #isCurrent(process: AgentRpcProcess, generation: number): boolean {
    return this.#active && this.#process === process && this.#processGeneration === generation;
  }

  /**
   * Publishes one monotonically sequenced Host event for this Session runtime.
   */
  #emit(type: HostAgentEvent['type'], payload: unknown): void {
    for (const listener of this.#observers) {
      try {
        listener();
      } catch {
        /* Observers cannot stop Agent event projection. */
      }
    }
    this.#publish({
      type,
      runtimeId: this.#binding.runtimeId,
      epoch: this.#binding.epoch,
      workspaceId: this.#binding.workspaceId,
      sessionId: this.#binding.sessionId,
      sequence: ++this.#sequence,
      timestamp: new Date(this.#now()).toISOString(),
      payload,
    });
  }
}
