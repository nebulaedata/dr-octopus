/**
 * @author Codex
 * @description Authenticated daemon lifecycle transport with task control, execution recovery and bounded shutdown.
 */
import { SchedulerChangeStream } from './change-stream.js';
import { SchedulerTranscriptReader } from '../infrastructure/transcript-reader.js';
import { openGrantRepository } from '../../permission-system/sdk/index.js';
import { SchedulerAuthorizationCoordinator } from '../sdk/authorization-coordinator.js';
import { inspectTaskTools } from '../infrastructure/authorization-probe.js';
import { inspectionConfigurationRevision } from '../infrastructure/inspection-configuration.js';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tryAcquireSingletonLease } from '../infrastructure/singleton-lease.js';
import { readMetadata, resolveSchedulerProfile, writeMetadata } from '../infrastructure/profile.js';
import { openSchedulerDatabase } from '../infrastructure/database.js';
import { SqliteSchedulerTaskRepository } from '../infrastructure/task-repository.js';
import { SchedulerDeliveryRepository } from '../infrastructure/delivery-repository.js';
import { SchedulerWorkRepository } from '../infrastructure/work-repository.js';
import { FileSchedulerSettingsStore } from '../infrastructure/settings-store.js';
import { AgentSchedulerRunner } from '../infrastructure/agent-runner.js';
import { SchedulerTaskService } from '../services/task-service.js';
import { SchedulerDeliveryService } from '../services/delivery-service.js';
import { SchedulerWorker } from '../services/worker.js';
import { SchedulerSettingsService } from '../services/settings-service.js';
import { handleSchedulerTaskRequest } from './task-routes.js';
import { SchedulerTaskError } from '../definitions/task-error.js';
import type { IncomingMessage } from 'node:http';
import type { SchedulerControl, SchedulerEndpoint } from '../definitions/service-lifecycle.js';

/**
 * Own the profile lock until task admission, Runner work, listener and database are all closed.
 */
export async function runSchedulerLifecycleServer(
  agentDir: string,
  explicitStart: boolean,
  expectedRevision: number
): Promise<void> {
  const profile = await resolveSchedulerProfile(agentDir, true);
  if (!profile) {
    throw new Error('Scheduler profile unavailable');
  }
  const lease = await tryAcquireSingletonLease(join(profile.directory, 'daemon.lock'));
  if (!lease) {
    return;
  }
  const controlPath = join(profile.directory, 'control.json');
  const endpointPath = join(profile.directory, 'endpoint.json');
  let database: ReturnType<typeof openSchedulerDatabase> | undefined;
  let worker: SchedulerWorker | undefined;
  let grants: ReturnType<typeof openGrantRepository> | undefined;
  try {
    let control = (await readMetadata<SchedulerControl>(controlPath)) ?? { stopped: false, revision: 0 };
    if (control.stopped && !explicitStart) {
      return;
    }
    if (explicitStart && control.revision !== expectedRevision) {
      return;
    }
    if (explicitStart) {
      control = { stopped: false, revision: control.revision + 1 };
      await writeMetadata(controlPath, control);
    }
    await writeMetadata(join(profile.directory, 'profile.json'), { profileId: profile.profileId, format: 1 });
    const credentialsDirectory = join(profile.directory, 'credentials');
    await mkdir(credentialsDirectory, { recursive: true, mode: 0o700 });
    const token = await readCredential(join(credentialsDirectory, 'control-token'));
    const taskToken = await readCredential(join(credentialsDirectory, 'task-token'));
    database = openSchedulerDatabase(join(profile.directory, 'scheduler.db'));
    const settingsService = new SchedulerSettingsService(new FileSchedulerSettingsStore(profile.directory));
    const settings = await settingsService.get();
    const transcripts = new SchedulerTranscriptReader(database, profile.directory);
    const taskRepository = new SqliteSchedulerTaskRepository(database);
    grants = openGrantRepository(agentDir);
    const taskService = new SchedulerTaskService(taskRepository, undefined, (task) => {
      if (task.authorizationRef) {
        grants!.revoke(task.authorizationRef.grantId, task.authorizationRef.grantRevision);
      }
    });
    const authorization = new SchedulerAuthorizationCoordinator(
      taskRepository,
      grants,
      profile.profileId,
      (task) => inspectTaskTools(agentDir, profile.directory, profile.profileId, task),
      (task) => inspectionConfigurationRevision(agentDir, task.cwd)
    );
    const deliveryService = new SchedulerDeliveryService(new SchedulerDeliveryRepository(database));
    const expected = Buffer.from('Bearer ' + token);
    const endpoint: SchedulerEndpoint = {
      protocol: 3,
      profileId: profile.profileId,
      daemonId: randomUUID(),
      port: 0,
      pid: process.pid,
    };
    const changeStream = new SchedulerChangeStream(() => {
      const status = worker?.diagnostics();
      const diagnostics = status && {
        active: status.active,
        degraded: status.degraded,
        queued: status.queued,
        running: status.running,
        nextRunAt: status.nextRunAt,
      };
      return JSON.stringify([database!.sqlite.prepare('select total_changes() as count').get(), diagnostics]);
    });
    const activeWorker = new SchedulerWorker(
      new SchedulerWorkRepository(database),
      new AgentSchedulerRunner(agentDir, profile.directory, undefined, profile.profileId),
      endpoint.daemonId,
      undefined,
      () => authorization.reconcile(),
      () => changeStream.changed()
    );
    worker = activeWorker;
    activeWorker.configure(settings.maxConcurrentRuns);
    activeWorker.start();
    let stopping = false;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const server = createServer((request, response) => {
      response.once('finish', () => changeStream.changed());
      void (async () => {
        if (
          await handleSchedulerTaskRequest(
            request,
            response,
            endpoint,
            taskToken,
            taskService,
            deliveryService,
            authorization,
            token,
            transcripts
          )
        ) {
          return;
        }
        const supplied = Buffer.from(request.headers.authorization ?? '');
        if (
          request.headers.origin !== undefined ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        ) {
          response.writeHead(403).end();
          return;
        }
        if (
          request.headers['x-scheduler-daemon'] !== endpoint.daemonId ||
          request.headers['x-scheduler-profile'] !== profile.profileId
        ) {
          response.writeHead(409).end();
          return;
        }
        if (request.method === 'GET' && request.url === '/scheduler/v1/service/events') {
          changeStream.connect(response);
          return;
        }
        response.setHeader('content-type', 'application/json');
        if (request.url === '/scheduler/v1/service/settings') {
          try {
            if (request.method === 'GET') {
              response.end(JSON.stringify(await settingsService.get()));
              return;
            }
            if (request.method === 'PUT') {
              const next = await settingsService.update(await readSettingsBody(request));
              activeWorker.configure(next.maxConcurrentRuns);
              changeStream.changed(true);
              activeWorker.wake();
              response.end(JSON.stringify(next));
              return;
            }
          } catch (error) {
            const conflict = error instanceof SchedulerTaskError && error.code.includes('CONFLICT');
            const invalid = error instanceof SchedulerTaskError && error.code.includes('INVALID');
            response.writeHead(conflict ? 409 : invalid ? 400 : 503).end(
              JSON.stringify({
                code: error instanceof SchedulerTaskError ? error.code : 'SCHEDULE_SETTINGS_UNAVAILABLE',
                message:
                  error instanceof SchedulerTaskError
                    ? error.message
                    : 'Scheduler settings could not be updated',
              })
            );
            return;
          }
        }
        if (request.method === 'GET' && request.url === '/scheduler/v1/service/status') {
          const diagnostics = activeWorker.diagnostics();
          response.end(
            JSON.stringify({
              ...endpoint,
              state: 'control-ready',
              taskControlReady: true,
              executionReady: diagnostics.active && !diagnostics.degraded,
              ...diagnostics,
            })
          );
          return;
        }
        if (request.method !== 'POST' || request.url !== '/scheduler/v1/service/stop' || stopping) {
          response.writeHead(404).end();
          return;
        }
        stopping = true;
        taskService.stopMutations();
        void writeMetadata(controlPath, { stopped: true, revision: control.revision + 1 })
          .then(() => activeWorker.close())
          .then(() => {
            response.end(JSON.stringify({ state: 'stopping' }));
            changeStream.close();
            server.close(finish);
            server.closeAllConnections();
          })
          .catch(() => {
            stopping = false;
            response.writeHead(503).end();
          });
      })().catch(() => {
        if (!response.headersSent) {
          response.writeHead(503).end();
        } else {
          response.destroy();
        }
      });
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.keepAliveTimeout = 1000;
    server.maxConnections = 32;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Scheduler listener unavailable');
    }
    endpoint.port = address.port;
    try {
      await writeMetadata(endpointPath, endpoint);
      await finished;
    } finally {
      changeStream.close();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
      await rm(endpointPath, { force: true });
    }
  } finally {
    await worker?.close();
    database?.sqlite.close();
    grants?.close();
    lease.release();
  }
}

/**
 * Read one small Scheduler settings document from the authenticated control channel.
 */
async function readSettingsBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    length += chunk.length;
    if (length > 4096) {
      throw new SchedulerTaskError('SCHEDULE_SETTINGS_INVALID', 'Invalid Scheduler settings');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SchedulerTaskError('SCHEDULE_SETTINGS_INVALID', 'Invalid Scheduler settings');
  }
}

/**
 * Read or create one purpose-specific local credential without replacing an existing value.
 */
async function readCredential(path: string): Promise<string> {
  let token: string;
  try {
    token = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    token = randomBytes(32).toString('base64url');
    await writeFile(path, token, { flag: 'wx', mode: 0o600 });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Scheduler credential is invalid');
  }
  return token;
}
