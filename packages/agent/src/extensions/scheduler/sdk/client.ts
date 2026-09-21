/**
 * @author Codex
 * @description Agent-owned scheduler client with automatic discovery, bounded transport and stable replay keys.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SchedulerLifecycleError } from '../definitions/lifecycle.js';
import { SchedulerTaskError } from '../definitions/task-error.js';
import { readMetadata, resolveSchedulerProfile } from '../infrastructure/profile.js';
import { tryAcquireSingletonLease } from '../infrastructure/singleton-lease.js';
import {
  getSchedulerServiceStatus,
  getSchedulerSettings,
  restartSchedulerService,
  startSchedulerService,
  stopSchedulerService,
  updateSchedulerSettings,
} from './lifecycle.js';
import type { ScheduledTaskInput, ScheduledTaskPatch } from '@octopus/shared/protocol/scheduled-tasks';
import type {
  SchedulerDeliveryPage,
  SchedulerDeliveryPort,
  SchedulerDeliveryReceipt,
} from '../definitions/delivery.js';
import type {
  SchedulerControlClient,
  SchedulerRequest,
  SchedulerRequestCaller,
} from '../definitions/port.js';
import type { SchedulerEndpoint, SchedulerServiceStatus } from '../definitions/service-lifecycle.js';
import type { SchedulerSettings, SchedulerSettingsUpdate } from '../definitions/settings.js';
import type {
  SchedulerPage,
  SchedulerRun,
  SchedulerTask,
  SchedulerTaskMutation,
} from '../definitions/tasks.js';

export interface SchedulerClientOptions {
  agentDir: string;
  workspaceId: string;
  cwd: string;
  configRevision: string;
  autoEnsure?: boolean;
}

interface ErrorResponse {
  code?: unknown;
  message?: unknown;
}

interface BoundedResponseReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}

/**
 * Read a response without allowing a compromised local endpoint to grow memory without limit.
 */
async function readResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader() as unknown as BoundedResponseReader | undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    while (true) {
      const item = await reader.read();
      if (item.done) {
        break;
      }
      if (!item.value) {
        throw new SchedulerTaskError('SCHEDULE_PROTOCOL_ERROR', 'Scheduler returned an invalid response');
      }
      length += item.value.length;
      if (length > 1024 * 1024) {
        await reader.cancel();
        throw new SchedulerTaskError('SCHEDULE_RESPONSE_TOO_LARGE', 'Scheduler response is too large');
      }
      chunks.push(item.value);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (cause) {
    throw new SchedulerTaskError('SCHEDULE_PROTOCOL_ERROR', 'Scheduler returned an invalid response', {
      cause,
    });
  }
}

/**
 * Keep task callers separate from lifecycle control and bind all mutable requests to one Workspace.
 */
export class AgentSchedulerClient implements SchedulerControlClient {
  private readonly closed = new AbortController();

  /**
   * Store immutable caller identity; session identity is supplied by the thin adapter per request.
   */
  constructor(private readonly options: SchedulerClientOptions) {}

  /**
   * Discover an existing daemon or automatically ensure one unless explicit stop intent suppresses it.
   */
  async connect(): Promise<SchedulerServiceStatus> {
    this.requireOpen();
    const status = await getSchedulerServiceStatus(this.options.agentDir);
    return status.state === 'control-ready'
      ? status
      : this.options.autoEnsure === false
        ? status
        : startSchedulerService(this.options.agentDir, false);
  }

  /**
   * Read lifecycle readiness without starting or mutating the service.
   */
  status(): Promise<SchedulerServiceStatus> {
    this.requireOpen();
    return getSchedulerServiceStatus(this.options.agentDir);
  }

  /**
   * Execute an explicit user lifecycle command, preserving stopped state until an explicit start or restart.
   */
  controlService(action: 'start' | 'stop' | 'restart'): Promise<SchedulerServiceStatus> {
    this.requireOpen();
    const operations = {
      start: startSchedulerService,
      stop: stopSchedulerService,
      restart: restartSchedulerService,
    };
    return operations[action](this.options.agentDir);
  }

  /**
   * Read the Agent-owned cron.json configuration without starting the daemon.
   */
  getSettings(): Promise<SchedulerSettings> {
    this.requireOpen();
    return getSchedulerSettings(this.options.agentDir);
  }

  /**
   * Update cron.json through the active daemon or the offline lifecycle fence.
   */
  updateSettings(input: SchedulerSettingsUpdate): Promise<SchedulerSettings> {
    this.requireOpen();
    return updateSchedulerSettings(this.options.agentDir, input);
  }

  /**
   * Execute the extension port contract, retrying one lost response with the original mutation key.
   */
  async request(request: SchedulerRequest, caller: SchedulerRequestCaller = {}): Promise<unknown> {
    this.requireOpen();
    let lastCause: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const status = await this.connect();
        if (status.state !== 'control-ready') {
          throw new SchedulerLifecycleError('SCHEDULER_UNAVAILABLE', 'Scheduler task control is unavailable');
        }
        return await this.send(status, request, caller);
      } catch (cause) {
        lastCause = cause;
        if (
          cause instanceof SchedulerTaskError ||
          cause instanceof SchedulerLifecycleError ||
          attempt === 1
        ) {
          throw cause;
        }
      }
    }
    throw new SchedulerLifecycleError('SCHEDULER_UNAVAILABLE', 'Scheduler task control is unavailable', {
      cause: lastCause,
    });
  }

  /**
   * List live tasks for the bound Workspace and optional source Session.
   */
  list(caller: SchedulerRequestCaller = {}, limit = 50, offset = 0): Promise<SchedulerPage<SchedulerTask>> {
    return this.request({ operation: 'list', input: { limit, offset } }, caller) as Promise<
      SchedulerPage<SchedulerTask>
    >;
  }

  /**
   * Get one live task inside the bound caller fence.
   */
  get(id: string, caller: SchedulerRequestCaller = {}): Promise<SchedulerTask> {
    return this.request({ operation: 'get', taskId: id }, caller) as Promise<SchedulerTask>;
  }

  /**
   * Persist a new task using the caller-provided stable idempotency key.
   */
  create(input: ScheduledTaskInput, key: string, caller: SchedulerRequestCaller = {}) {
    return this.request({ operation: 'create', input, key }, caller) as Promise<SchedulerTaskMutation>;
  }

  /**
   * Apply a revision-guarded patch.
   */
  update(id: string, revision: number, input: ScheduledTaskPatch, key: string, caller = {}) {
    return this.request(
      { operation: 'update', taskId: id, revision, input, key },
      caller
    ) as Promise<SchedulerTaskMutation>;
  }

  /**
   * Soft-delete a task with optimistic concurrency.
   */
  delete(id: string, revision: number, key: string, caller = {}) {
    return this.request(
      { operation: 'delete', taskId: id, revision, input: {}, key },
      caller
    ) as Promise<SchedulerTaskMutation>;
  }

  /**
   * Queue an isolated manual run without changing the schedule phase.
   */
  runNow(id: string, key: string, caller = {}) {
    return this.request(
      { operation: 'run-now', taskId: id, input: {}, key },
      caller
    ) as Promise<SchedulerTaskMutation>;
  }

  /**
   * Persist cancellation or active cancellation intent for one Run.
   */
  cancel(id: string, runId: string, key: string, caller = {}) {
    return this.request(
      { operation: 'cancel', taskId: id, input: { runId }, key },
      caller
    ) as Promise<SchedulerTaskMutation>;
  }

  /**
   * Read retained run history, including a soft-deleted parent task.
   */
  history(id: string, caller: SchedulerRequestCaller = {}, limit = 50, offset = 0) {
    return this.request({ operation: 'history', taskId: id, input: { limit, offset } }, caller) as Promise<
      SchedulerPage<SchedulerRun>
    >;
  }

  /**
   * Bind delivery access to one source Session so individual calls cannot redirect records.
   */
  forOrigin(originSessionRef: string): SchedulerDeliveryPort {
    const caller = { originSessionRef };
    return {
      acquireLease: async () => {
        const profile = await resolveSchedulerProfile(this.options.agentDir, true);
        if (!profile) {
          throw new SchedulerLifecycleError('SCHEDULER_PROFILE_MISSING', 'Scheduler profile is unavailable');
        }
        const identity = createHash('sha256').update(originSessionRef).digest('hex');
        return tryAcquireSingletonLease(join(profile.directory, `delivery-${identity}.lock`));
      },
      listPending: (signal) =>
        this.request({ operation: 'delivery-list', signal }, caller) as Promise<SchedulerDeliveryPage>,
      ack: (deliveryId, originEntryId, signal) =>
        this.request(
          { operation: 'delivery-ack', deliveryId, originEntryId, signal },
          caller
        ) as Promise<SchedulerDeliveryReceipt>,
      defer: (deliveryId, availableAt, errorCode, signal) =>
        this.request(
          { operation: 'delivery-defer', deliveryId, availableAt, errorCode, signal },
          caller
        ) as Promise<SchedulerDeliveryReceipt>,
    };
  }

  /**
   * Abort in-flight fetches and reject future use after extension replacement.
   */
  close(): void {
    this.closed.abort();
  }

  /**
   * Send one authenticated request to the exact discovered daemon identity.
   */
  private async send(
    endpoint: SchedulerEndpoint,
    request: SchedulerRequest,
    caller: SchedulerRequestCaller
  ): Promise<unknown> {
    const profile = await resolveSchedulerProfile(this.options.agentDir, false);
    if (!profile || profile.profileId !== endpoint.profileId) {
      throw new SchedulerLifecycleError('SCHEDULER_PROFILE_MISMATCH', 'Scheduler profile mismatch');
    }
    const current = await readMetadata<SchedulerEndpoint>(join(profile.directory, 'endpoint.json'));
    if (!current || current.daemonId !== endpoint.daemonId || current.port !== endpoint.port) {
      throw new Error('Scheduler endpoint changed before request');
    }
    const userControl = [
      'authorization-preview',
      'authorize',
      'revoke-authorization',
      'restore',
      'purge',
      'run-result',
    ].includes(request.operation);
    const token = await readFile(
      join(profile.directory, 'credentials', userControl ? 'control-token' : 'task-token'),
      'utf8'
    );
    const { signal: requestSignal, ...command } = request;
    const signal = AbortSignal.any(
      [this.closed.signal, requestSignal, AbortSignal.timeout(userControl ? 60_000 : 5000)].filter(
        (value): value is AbortSignal => value !== undefined
      )
    );
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/scheduler/v1/tasks/request`, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'x-scheduler-daemon': endpoint.daemonId,
        'x-scheduler-profile': endpoint.profileId,
      },
      body: JSON.stringify({
        context: {
          workspaceId: this.options.workspaceId,
          cwd: this.options.cwd,
          configRevision: this.options.configRevision,
          ...(caller.originSessionRef === undefined ? {} : { originSessionRef: caller.originSessionRef }),
        },
        request: command,
      }),
    });
    const value = await readResponse(response);
    if (!response.ok) {
      const failure = value as ErrorResponse;
      throw new SchedulerTaskError(
        typeof failure.code === 'string' ? failure.code : 'SCHEDULE_REQUEST_REJECTED',
        typeof failure.message === 'string' ? failure.message : 'Scheduler request was rejected'
      );
    }
    return value;
  }

  /**
   * Reject use after the owning extension instance has shut down.
   */
  private requireOpen(): void {
    if (this.closed.signal.aborted) {
      throw new SchedulerLifecycleError('SCHEDULER_REQUEST_CANCELLED', 'Scheduler client is closed');
    }
  }
}

/**
 * Create the stable Agent-side SDK entry used by built-in extensions and thin Hosts.
 */
export function createSchedulerClient(options: SchedulerClientOptions): AgentSchedulerClient {
  return new AgentSchedulerClient(options);
}
