/**
 * @author Codex
 * @description Single-owner loopback memory daemon with identity-bound control and graceful shutdown.
 */
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tryAcquireProcessLock } from '../../../lib/daemon-platform/singleton-lease.js';
import { memoryProfile, readMemoryMetadata, writeMemoryMetadata } from '../lib/profile.js';
import { MemoryError } from '../definitions/error.js';
import type { createMemoryApplication } from './application.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MemoryControl, MemoryServiceStatus } from '../definitions/lifecycle.js';

/**
 * Bound request bytes before parsing JSON or copying file content.
 */
async function body(request: IncomingMessage, limit: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = chunk as Buffer;
    length += bytes.length;
    if (length > limit) {
      throw new MemoryError('PAYLOAD_TOO_LARGE', '请求正文超过限制');
    }
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}

/**
 * Send only structured values and safe domain failures.
 */
function respond(response: ServerResponse, status: number, value: unknown): void {
  if (!response.destroyed) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(value));
  }
}

/**
 * Acquire the lifetime OS lock before opening storage, then expose only loopback authenticated operations.
 */
async function main(): Promise<void> {
  const [dataRoot, action, observedRevision, migrationsFolder] = process.argv.slice(2);
  if (!dataRoot || !['start', 'ensure'].includes(action ?? '')) {
    throw new Error('Memory daemon requires a product data root and lifecycle action');
  }
  const profile = (await memoryProfile(dataRoot, true))!;
  const lock = await tryAcquireProcessLock(join(profile.directory, 'daemon.lock'));
  if (!lock) {
    return;
  }
  let application: Awaited<ReturnType<typeof createMemoryApplication>> | undefined;
  const inFlight = new Set<Promise<void>>();
  try {
    let control = (await readMemoryMetadata<MemoryControl>(join(profile.directory, 'control.json'))) ?? {
      stopped: false,
      revision: 0,
    };
    if (control.stopped && (action === 'ensure' || control.revision !== Number(observedRevision))) {
      return;
    }
    control = { stopped: false, revision: control.revision + 1 };
    await rm(join(profile.directory, 'startup-error.json'), { force: true });
    await writeMemoryMetadata(join(profile.directory, 'control.json'), control);
    let token: string;
    try {
      token = await readFile(join(profile.directory, 'control-token'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      token = randomBytes(32).toString('hex');
      await writeFile(join(profile.directory, 'control-token'), token, { flag: 'wx', mode: 0o600 });
    }
    application = await (
      await import('./application.js')
    ).createMemoryApplication(profile.directory, migrationsFolder);
    const app = application;
    const daemonId = randomUUID();
    const started = Date.now();
    const controllers = new Set<AbortController>();
    let stopping = false;
    let resolveStopped: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    /**
     * Build health from local dependencies and configuration without network probes or background starts.
     */
    function status(): MemoryServiceStatus {
      return {
        schemaVersion: 1,
        state: stopping ? 'stopping' : 'running',
        health: 'ready',
        profileId: profile.profileId,
        daemonId,
        pid: process.pid,
        autostartSuppressed: control.stopped,
        controlRevision: control.revision,
        uptimeMs: Date.now() - started,
        checks: [{ name: 'sqlite', status: 'pass' }],
      };
    }
    /**
     * Stop intent becomes durable before request acmemoryment; one shutdown drains all active work.
     */
    async function stop(persist: boolean): Promise<void> {
      if (stopping) {
        return;
      }
      stopping = true;
      if (persist) {
        control = { stopped: true, revision: control.revision + 1 };
        await writeMemoryMetadata(join(profile.directory, 'control.json'), control);
      }
      for (const controller of controllers) {
        controller.abort();
      }
      resolveStopped();
    }
    const server = createServer((request, response) => {
      if (inFlight.size >= 256) {
        respond(response, 503, { code: 'STORE_UNAVAILABLE', message: '记忆服务繁忙，请稍后重试。' });
        request.resume();
        return;
      }
      const controller = new AbortController();
      controllers.add(controller);
      response.once('close', () => {
        controller.abort();
        controllers.delete(controller);
      });
      const execution = (async () => {
        const expected = Buffer.from('Bearer ' + token);
        const supplied = Buffer.from(request.headers.authorization ?? '');
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected) ||
          request.headers['x-memory-profile'] !== profile.profileId ||
          request.headers['x-memory-daemon'] !== daemonId
        ) {
          respond(response, 401, { code: 'UNAUTHORIZED', message: '记忆服务身份校验失败' });
          return;
        }
        const route = request.url;
        if (request.method === 'GET' && (route === '/memory/v1/status' || route === '/memory/v1/health')) {
          respond(response, 200, status());
        } else if (request.method === 'POST' && route === '/memory/v1/stop') {
          await stop(true);
          respond(response, 200, status());
        } else if (stopping) {
          respond(response, 503, { code: 'MEMORY_SERVICE_STOPPED', message: '记忆服务正在停止' });
        } else if (request.method === 'POST' && route === '/memory/v1/call') {
          const input: unknown = JSON.parse((await body(request, 1024 * 1024)).toString('utf8'));
          respond(response, 200, await app.call(input, controller.signal));
        } else {
          respond(response, 404, { code: 'NOT_FOUND', message: '记忆服务端点不存在' });
        }
      })().catch((error: unknown) => {
        const failure =
          error instanceof MemoryError ? error : new MemoryError('MEMORY_UNAVAILABLE', '记忆服务操作失败');
        respond(response, failure.code === 'NOT_FOUND' ? 404 : failure.code === 'FORBIDDEN' ? 403 : 400, {
          code: failure.code,
          message: failure.message,
        });
      });
      inFlight.add(execution);
      void execution.finally(() => inFlight.delete(execution));
    });
    server.requestTimeout = 120_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Memory daemon did not bind TCP');
    }
    await writeMemoryMetadata(join(profile.directory, 'endpoint.json'), {
      protocolVersion: 1,
      profileId: profile.profileId,
      daemonId,
      port: address.port,
    });
    process.once('SIGTERM', () => {
      void stop(false);
    });
    process.once('SIGINT', () => {
      void stop(false);
    });
    await stopped;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // A management client may retain an active keep-alive socket; stop must not depend on its lifetime.
      setImmediate(() => server.closeAllConnections());
    });
    await rm(join(profile.directory, 'endpoint.json'), { force: true });
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z0-9_]{1,64}$/u.test(error.code)
        ? error.code
        : 'BOOTSTRAP_FAILED';
    await writeMemoryMetadata(join(profile.directory, 'startup-error.json'), {
      at: Date.now(),
      code,
    }).catch(() => undefined);
    throw error;
  } finally {
    try {
      await Promise.allSettled(inFlight);
      await application?.close();
    } finally {
      lock.release();
    }
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
