/**
 * @author Codex
 * @description Coordinates Session-first Runtime Slots, capacity, process recovery, and fenced operations.
 */

import { randomUUID } from 'node:crypto';
import { createWorkspaceSessionBootstrap } from '@octopus/agent';
import { AgentProcessManager } from '@octopus/agent/rpc';
import { canonicalizePath } from '../../utils/index.js';
import { activateBootstrappedSession } from './activation.js';
import { SessionRuntimeAdmission } from './admission.js';
import { waitForRuntime } from './deadline.js';
import { ManagedSessionRuntime } from './managed-session.js';
import { SessionRuntimeOperation } from './operation.js';
import { PiSessionRepository } from './pi-session-repository.js';
import { SessionRuntimeRetirement } from './retirement.js';
import { SessionRuntimeDirectory } from './runtime-directory.js';
import { SessionRuntimeError } from './errors.js';
import { restartSessionRuntime } from './restart.js';
import { RuntimeConfigChanges } from '../runtime-config/runtime-config-changes.js';
import { DEFAULT_SESSION_RUNTIME_LIMITS } from './types.js';
import { canonicalizeWorkspace } from './utils.js';
import {
  assertCatalogBinding,
  assertExpectedAgentSessionId,
  assertReadinessIdentity,
  assertWorkspaceCwd,
  requireRpcState,
} from './validator.js';
import type { WorkspaceDescriptor, WorkspaceSessionBootstrap } from '@octopus/agent';
import type { RestartSessionBody, SessionRuntimeControlDto } from '@octopus/shared/protocol';
import type { AgentRpcProcessOptions } from '@octopus/agent/rpc';
import type { SessionRuntimeSlot } from './runtime-slot.js';
import type {
  ActivateExistingSessionInput,
  ActivateNewSessionInput,
  HostAgentEvent,
  SessionRuntimeBinding,
  SessionRuntimeDiagnostics,
  SessionRuntimeLimits,
  SessionRuntimeRequestOptions,
} from './types.js';

export interface SessionRuntimeCoordinatorOptions {
  /**
   * Fences new Session work when its Host has accepted a restart or stop.
   */
  assertOpen?(this: void): void;
  configChanges?: RuntimeConfigChanges;
  restartTimeoutMs?: number;
  manager?: AgentProcessManager;
  limits?: Partial<SessionRuntimeLimits>;
  processOptions?: Omit<AgentRpcProcessOptions, 'workspace' | 'sessionPath'>;
  now?: () => number;
  createRuntimeId?: () => string;
  piSessions?: PiSessionRepository;
  sessionBootstrap?: WorkspaceSessionBootstrap;
  activationTimeoutMs?: number;
  operationTimeoutMs?: number;
  shutdownDrainTimeoutMs?: number;
  admissionQueueLimit?: number;
  admissionWaitTimeoutMs?: number;
}

export interface SessionRuntimeReservation {
  binding: SessionRuntimeBinding;
  release: () => void;
}

/**
 * Owns Host policy while delegating all per-Session ownership to one stable Runtime Slot.
 */
export class SessionRuntimeCoordinator {
  public readonly configChanges: RuntimeConfigChanges;
  readonly #controlListeners = new Set<(sessionId?: string) => void>();
  readonly #restartTimeoutMs: number;
  readonly #unsubscribeConfig: () => void;
  readonly #manager: AgentProcessManager;
  readonly #directory = new SessionRuntimeDirectory();
  readonly #admission: SessionRuntimeAdmission;
  readonly #retirement: SessionRuntimeRetirement;
  readonly #piSessions: PiSessionRepository;
  readonly #sessionBootstrap: NonNullable<SessionRuntimeCoordinatorOptions['sessionBootstrap']>;
  readonly #processOptions: NonNullable<SessionRuntimeCoordinatorOptions['processOptions']>;
  readonly #now: () => number;
  readonly #createRuntimeId: () => string;
  readonly #activationTimeoutMs: number;
  readonly #operationTimeoutMs: number;
  readonly #listeners = new Set<(event: HostAgentEvent) => void>();
  #closing = false;
  readonly #hostAssertOpen: (() => void) | undefined;

  /**
   * Creates Host runtime orchestration with injectable process and deterministic test dependencies.
   */
  public constructor(options: SessionRuntimeCoordinatorOptions = {}) {
    this.#hostAssertOpen = options.assertOpen;
    this.configChanges = options.configChanges ?? new RuntimeConfigChanges();
    this.#restartTimeoutMs = options.restartTimeoutMs ?? 60_000;
    this.#unsubscribeConfig = this.configChanges.subscribe(() => this.#publishControl());
    this.#manager = options.manager ?? new AgentProcessManager();
    this.#piSessions = options.piSessions ?? new PiSessionRepository();
    this.#sessionBootstrap = options.sessionBootstrap ?? createWorkspaceSessionBootstrap();
    this.#processOptions = options.processOptions ?? {};
    this.#now = options.now ?? Date.now;
    this.#createRuntimeId = options.createRuntimeId ?? randomUUID;
    this.#activationTimeoutMs = options.activationTimeoutMs ?? 30_000;
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 30_000;
    this.#retirement = new SessionRuntimeRetirement(
      this.#manager,
      this.#directory,
      options.shutdownDrainTimeoutMs ?? 10_000
    );
    this.#admission = new SessionRuntimeAdmission(
      this.#directory,
      { ...DEFAULT_SESSION_RUNTIME_LIMITS, ...options.limits },
      this.#now,
      async (runtimeId) => this.#retirement.stop(runtimeId),
      options.admissionQueueLimit ?? 128,
      options.admissionWaitTimeoutMs ?? 30_000
    );
  }

  /**
   * Opens an existing Session through its shared Slot activation Promise.
   */
  public async activateExisting(input: ActivateExistingSessionInput): Promise<SessionRuntimeBinding> {
    return this.withExisting(input, (target) => Promise.resolve(target.binding));
  }

  /**
   * Activates and pins one runtime generation for a complete Session-scoped operation.
   */
  public async withExisting<T>(
    input: ActivateExistingSessionInput,
    operation: (target: SessionRuntimeOperation) => Promise<T>,
    request: SessionRuntimeRequestOptions = {}
  ): Promise<T> {
    this.#assertOpen();
    const slot = this.#directory.getOrCreate(input.sessionId);
    slot.lifecycle.assertAvailable();
    const releaseDemand = slot.acquireDemand();
    try {
      const runtime = await waitForRuntime(
        this.#activateExistingSlot(slot, input),
        request,
        this.#activationTimeoutMs,
        this.#now,
        'activation'
      );
      const binding = runtime.getBinding();
      slot.lifecycle.assertAvailable();
      const acquired = new SessionRuntimeOperation(runtime, binding.epoch, () => {
        this.#hostAssertOpen?.();
        this.#directory.assertFence(input.sessionId, binding.runtimeId, binding.epoch);
      });
      releaseDemand();
      try {
        return await waitForRuntime(
          operation(acquired),
          request,
          this.#operationTimeoutMs,
          this.#now,
          'operation'
        );
      } finally {
        acquired.release();
      }
    } finally {
      releaseDemand();
    }
  }

  /**
   * Keeps one active Session generation resident for a transport subscription.
   *
   * @param input Existing catalog Session identity and Workspace authority.
   * @returns Runtime binding plus an idempotent reservation release callback.
   */
  public async reserveExisting(
    input: ActivateExistingSessionInput,
    request: SessionRuntimeRequestOptions = {}
  ): Promise<SessionRuntimeReservation> {
    this.#assertOpen();
    const slot = this.#directory.getOrCreate(input.sessionId);
    slot.lifecycle.assertAvailable();
    const releaseDemand = slot.acquireDemand();
    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      releaseDemand();
    };
    try {
      const runtime = await waitForRuntime(
        this.#activateExistingSlot(slot, input),
        request,
        this.#activationTimeoutMs,
        this.#now,
        'subscription activation'
      );
      const binding = runtime.getBinding();
      slot.assertFence(binding.runtimeId, binding.epoch);
      return { binding, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  /**
   * Creates a new Pi Session through the same Session-first Slot authority.
   */
  public async activateNew(
    input: ActivateNewSessionInput,
    request: SessionRuntimeRequestOptions = {}
  ): Promise<SessionRuntimeBinding> {
    this.#assertOpen();
    const slot = this.#directory.getOrCreate(input.sessionId);
    slot.lifecycle.assertAvailable();
    const releaseDemand = slot.acquireDemand();
    try {
      const runtime = await waitForRuntime(
        slot.activate((epoch) => this.#startNewRuntime(slot, input, epoch)),
        request,
        this.#activationTimeoutMs,
        this.#now,
        'new Session activation'
      );
      return runtime.getBinding();
    } finally {
      releaseDemand();
    }
  }

  /**
   * Returns an immutable binding snapshot for one runtime generation identity.
   */
  public getBinding(runtimeId: string): SessionRuntimeBinding {
    return this.#directory.requireRuntime(runtimeId).getBinding();
  }

  /**
   * Lists resident runtime bindings scoped to one Workspace.
   */
  public listWorkspace(workspaceId: string): SessionRuntimeBinding[] {
    return this.#directory.listWorkspace(workspaceId);
  }

  /**
   * Resolves the resident runtime bound to a stable Session identity.
   */
  public getBindingBySessionId(sessionId: string): SessionRuntimeBinding | undefined {
    return this.#directory.getRuntimeBySessionId(sessionId)?.getBinding();
  }

  /**
   * Returns a point-in-time lifecycle snapshot for health reporting and leak detection.
   */
  public getDiagnostics(): SessionRuntimeDiagnostics {
    const slots = this.#directory.getSnapshots();
    const slotStates: SessionRuntimeDiagnostics['slotStates'] = {
      empty: 0,
      activating: 0,
      active: 0,
      draining: 0,
    };
    for (const slot of slots) {
      slotStates[slot.state] += 1;
    }
    return {
      activeRuntimeCount: this.#directory.count(),
      admissionQueueDepth: this.#admission.getQueueDepth(),
      slotCount: slots.length,
      slotStates,
      slots,
    };
  }

  /**
   * Reports whether the process-local Coordinator still accepts Session work.
   */
  public isAcceptingRequests(): boolean {
    return !this.#closing;
  }

  /**
   * Subscribes to identity-bearing Host events from every managed runtime.
   */
  public onEvent(listener: (event: HostAgentEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Stops one runtime generation through its owning Slot.
   */
  public stop(runtimeId: string): Promise<void> {
    this.#directory.findByRuntimeId(runtimeId)?.lifecycle.assertAvailable();
    return this.#retirement.stop(runtimeId);
  }

  /**
   * Projects configuration staleness and lifecycle status without activating a process.
   */
  public getControl(sessionId: string): SessionRuntimeControlDto {
    const slot = this.#directory.get(sessionId);
    if (!slot) {
      return { restartRequired: false, changedConfigRoutes: [], restart: { status: 'idle' } };
    }
    const runtime = slot.getRuntime();
    const changedConfigRoutes = runtime ? this.configChanges.since(runtime.configRevision) : [];
    const restart = slot.lifecycle.snapshot();
    if (slot.getState() === 'draining' && restart.error) {
      restart.error.retryable = false;
    }
    return { restartRequired: changedConfigRoutes.length > 0, changedConfigRoutes, restart };
  }

  /**
   * Connects business invalidation observers without exposing transport to runtime internals.
   */
  public onControlChanged(listener: (sessionId?: string) => void): () => void {
    this.#controlListeners.add(listener);
    return () => this.#controlListeners.delete(listener);
  }

  /**
   * Retires a Session and deletes its artifacts under one lifecycle gate.
   */
  public async deleteSession<T>(sessionId: string, remove: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    const slot = this.#directory.getOrCreate(sessionId);
    return slot.lifecycle.exclusive(async () => {
      await slot.settleActivation();
      const runtime = slot.getRuntime();
      if (runtime) {
        await this.#retirement.stop(runtime.getBinding().runtimeId);
      }
      const result = await remove();
      slot.lifecycle.markDeleted();
      return result;
    });
  }

  /**
   * Restarts the exact expected generation and restores its original durable Session identity.
   */
  public restart(
    input: ActivateExistingSessionInput,
    request: RestartSessionBody
  ): Promise<SessionRuntimeBinding> {
    this.#assertOpen();
    const slot = this.#directory.getOrCreate(input.sessionId);
    return restartSessionRuntime({
      slot,
      request,
      timeoutMs: this.#restartTimeoutMs,
      stop: (runtimeId) => this.#retirement.stop(runtimeId),
      activate: async (assertLive) => {
        const checkRestart = (): void => {
          assertLive();
          this.#assertOpen();
        };
        checkRestart();
        const replacement = await slot.activate((epoch) =>
          this.#startExistingRuntime(slot, input, epoch, checkRestart)
        );
        return replacement.getBinding();
      },
      publish: () => this.#publishControl(input.sessionId),
    });
  }

  /**
   * Isolates observer failures from committed configuration and lifecycle operations.
   */
  #publishControl(sessionId?: string): void {
    for (const listener of this.#controlListeners) {
      try {
        listener(sessionId);
      } catch {
        /* The query projection remains authoritative. */
      }
    }
  }

  /**
   * Stops every runtime and opens the process supervisor shutdown gate.
   */
  public async close(): Promise<void> {
    this.#closing = true;
    this.#unsubscribeConfig();
    this.#controlListeners.clear();
    this.configChanges.close();
    await this.#retirement.close();
  }

  /**
   * Canonicalizes and activates an existing Session through one cached Slot Promise.
   */
  async #activateExistingSlot(
    slot: SessionRuntimeSlot,
    input: ActivateExistingSessionInput
  ): Promise<ManagedSessionRuntime> {
    const runtime = await slot.activate((epoch) => this.#startExistingRuntime(slot, input, epoch));
    assertCatalogBinding(input, runtime.getBinding());
    return runtime;
  }

  /**
   * Validates and starts one existing Session inside serialized capacity admission.
   */
  async #startExistingRuntime(
    slot: SessionRuntimeSlot,
    input: ActivateExistingSessionInput,
    epoch: number,
    assertLive: () => void = () => slot.lifecycle.assertAvailable()
  ): Promise<ManagedSessionRuntime> {
    const canonicalPath = await canonicalizePath(input.sessionPath);
    this.#directory.bindCanonicalSessionPath(slot, canonicalPath);
    return this.#admission.run(async () => {
      const workspace = await canonicalizeWorkspace(input.workspace);
      const metadata = await this.#piSessions.readMetadata(canonicalPath);
      assertExpectedAgentSessionId(input.expectedAgentSessionId, metadata.sessionId);
      await assertWorkspaceCwd(workspace.cwd, metadata.cwd);
      await this.#admission.ensureCapacity(workspace.id);
      this.#hostAssertOpen?.();
      assertLive();
      const configRevision = this.configChanges.current();
      const runtimeId = this.#createRuntimeId();
      try {
        const process = await this.#manager.start(runtimeId, {
          ...this.#processOptions,
          workspace,
          sessionPath: canonicalPath,
        });
        const state = requireRpcState(process.getLastSessionState(), runtimeId);
        await assertReadinessIdentity(state, metadata.sessionId, canonicalPath);
        assertLive();
        return this.#createRuntime(
          runtimeId,
          epoch,
          workspace,
          input.sessionId,
          metadata.sessionId,
          canonicalPath,
          process,
          state,
          configRevision
        );
      } catch (error) {
        try {
          await this.#manager.stop(runtimeId);
        } catch (cleanupError) {
          slot.lifecycle.markUnsafe();
          throw cleanupError;
        }
        throw error;
      }
    });
  }

  /**
   * Bootstraps and starts one new Pi Session inside serialized capacity admission.
   */
  async #startNewRuntime(
    slot: SessionRuntimeSlot,
    input: ActivateNewSessionInput,
    epoch: number
  ): Promise<ManagedSessionRuntime> {
    const workspace = await canonicalizeWorkspace(input.workspace);
    return this.#admission.run(async () => {
      await this.#admission.ensureCapacity(workspace.id);
      this.#hostAssertOpen?.();
      const runtimeId = this.#createRuntimeId();
      const configRevision = this.configChanges.current();
      return activateBootstrappedSession({
        workspace,
        runtimeId,
        manager: this.#manager,
        piSessions: this.#piSessions,
        bootstrap: this.#sessionBootstrap,
        processOptions: this.#processOptions,
        createRuntime: (agentSessionId, canonicalPath, process, state) => {
          this.#directory.bindCanonicalSessionPath(slot, canonicalPath);
          return this.#createRuntime(
            runtimeId,
            epoch,
            workspace,
            input.sessionId,
            agentSessionId,
            canonicalPath,
            process,
            state,
            configRevision
          );
        },
      });
    });
  }

  /**
   * Constructs an unpublished managed runtime for its Slot to commit atomically.
   */
  #createRuntime(
    runtimeId: string,
    epoch: number,
    workspace: WorkspaceDescriptor,
    sessionId: string,
    agentSessionId: string,
    canonicalPath: string,
    process: Awaited<ReturnType<AgentProcessManager['start']>>,
    state: ReturnType<typeof requireRpcState>,
    configRevision: number
  ): ManagedSessionRuntime {
    return new ManagedSessionRuntime({
      configRevision,
      binding: {
        runtimeId,
        epoch,
        workspaceId: workspace.id,
        workspaceCwd: workspace.cwd,
        sessionId,
        agentSessionId,
        sessionPath: canonicalPath,
      },
      process,
      state,
      manager: this.#manager,
      now: this.#now,
      publish: (event) => this.#emit(event),
    });
  }

  /**
   * Rejects new activation after Coordinator shutdown begins.
   */
  #assertOpen(): void {
    this.#hostAssertOpen?.();
    if (this.#closing) {
      throw new SessionRuntimeError('SESSION_RUNTIME_STALE', 'Session runtime coordinator is closing.');
    }
  }

  /**
   * Fans one Host event out to Coordinator subscribers.
   */
  #emit(event: HostAgentEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}
