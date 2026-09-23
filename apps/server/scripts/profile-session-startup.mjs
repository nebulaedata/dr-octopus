/**
 * @author Codex
 * @description Profiles real new/cold/warm Session service flows with an isolated catalog and Session files.
 * Run from apps/server: node --import tsx scripts/profile-session-startup.mjs [workspaceId] [samples] [output.json] [mode]
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { initializeAgentEnvironment } from '@octopus/agent/environment';

initializeAgentEnvironment();
const { createWorkspaceService, createWorkspaceSessionBootstrap } = await import('@octopus/agent');
const { AgentProcessManager, AgentRpcProcess } = await import('@octopus/agent/rpc');
const { SessionRuntimeCoordinator } = await import('../src/infrastructure/runtime/coordinator.ts');
const { SessionRuntimeAdmission } = await import('../src/infrastructure/runtime/admission.ts');
const { PiSessionRepository } = await import('../src/infrastructure/runtime/pi-session-repository.ts');
const { SessionsService } = await import('../src/modules/sessions/sessions.service.ts');
const { SessionsRepository } = await import('../src/modules/sessions/sessions.repository.ts');
const { createDatabase } = await import('../src/db/client.ts');

const workspaceId = process.argv[2] ?? 'general';
const samples = Number(process.argv[3] ?? 3);
const mode = process.argv[5] ?? 'default';
if (!['default', 'draft', 'production', 'no-external-extensions'].includes(mode)) {
  throw new Error('mode must be default, draft, production, or no-external-extensions');
}
if (!Number.isInteger(samples) || samples < 1 || samples > 20) {
  throw new Error('samples must be an integer between 1 and 20');
}
const context = new AsyncLocalStorage();
const results = [];
const restorations = [];

/**
 * Records inclusive wall time without changing synchronous methods into asynchronous ones.
 */
function measure(stage, operation) {
  const trace = context.getStore();
  if (!trace || trace.finished) return operation();
  const start = performance.now();
  const span = { stage, startMs: start - trace.started, durationMs: 0, status: 'ok' };
  trace.spans.push(span);
  /**
   * Settles a span on both success and failure.
   */
  function finish(error) {
    span.durationMs = performance.now() - start;
    if (error) span.status = 'error';
  }
  try {
    const value = operation();
    if (value && typeof value.then === 'function') {
      return value.then(
        (result) => {
          finish();
          return result;
        },
        (error) => {
          finish(error);
          throw error;
        }
      );
    }
    finish();
    return value;
  } catch (error) {
    finish(error);
    throw error;
  }
}

/**
 * Temporarily instruments only this diagnostic process; production sources remain unchanged.
 */
function instrument(target, method, label = method) {
  const original = target[method];
  target[method] = function (...args) {
    const stage = typeof label === 'function' ? label(...args) : label;
    return measure(stage, () => original.apply(this, args));
  };
  restorations.push(() => {
    target[method] = original;
  });
}

instrument(AgentRpcProcess.prototype, 'execute', (command) => `rpc.${command.type}`);
instrument(SessionRuntimeAdmission.prototype, 'ensureCapacity', 'capacity.reclaim');
const originalAdmission = SessionRuntimeAdmission.prototype.run;
SessionRuntimeAdmission.prototype.run = function (operation, request) {
  const trace = context.getStore();
  const start = performance.now();
  return originalAdmission.call(
    this,
    () => {
      trace?.spans.push({
        stage: 'admission.queue',
        startMs: start - trace.started,
        durationMs: performance.now() - start,
        status: 'ok',
      });
      return operation();
    },
    request
  );
};
restorations.push(() => {
  SessionRuntimeAdmission.prototype.run = originalAdmission;
});

const root = await mkdtemp(join(tmpdir(), 'octopus-session-profile-'));
const database = createDatabase(join(root, 'catalog.db'));
const workspaces = createWorkspaceService();
instrument(workspaces, 'resolve', 'workspace.resolve');
const bootstrap = createWorkspaceSessionBootstrap();
const repository = new SessionsRepository(database);
instrument(repository, 'upsert', 'catalog.upsert');
instrument(repository, 'createDraft', 'catalog.createDraft');
const piSessions = new PiSessionRepository();
for (const method of ['readMetadata', 'getBranch', 'getEntries'])
  instrument(piSessions, method, `session.${method}`);
const manager = new AgentProcessManager();
const originalStart = manager.start.bind(manager);
manager.start = async (...args) =>
  measure('process.startToReady', async () => {
    const child = await originalStart(...args);
    const stderr = child.getStderr();
    const entry = stderr.match(/^SESSION_PROFILE (.+)$/m);
    const piTimings = [...stderr.matchAll(/^  (.+): (\d+)ms$/gm)].map((match) => ({
      stage: match[1],
      durationMs: Number(match[2]),
    }));
    const spans = [...stderr.matchAll(/^SESSION_SPAN (.+)$/gm)].map((match) => JSON.parse(match[1]));
    const trace = context.getStore();
    if (trace) trace.child = { entry: entry ? JSON.parse(entry[1]) : null, piTimings, spans };
    return child;
  });
const runtime = new SessionRuntimeCoordinator({
  manager,
  piSessions,
  sessionBootstrap: {
    /**
     * Uses the production header bootstrap while redirecting only diagnostic Session artifacts.
     */
    create(cwd) {
      return measure('session.createHeader', () => bootstrap.create(cwd, { cwd, sessionDir: root }));
    },
  },
  processOptions: {
    ...(mode === 'production'
      ? {}
      : {
          cliPath: fileURLToPath(new URL('./session-startup-child.mjs', import.meta.url)),
        }),
    childEnvironment: { PI_TIMING: '1', SESSION_PROFILE_MODE: mode },
  },
});
instrument(runtime, 'activateNew', 'runtime.activateNew');
instrument(runtime, 'withExisting', 'runtime.withExisting');
const service = new SessionsService(
  { database },
  { runtime, workspaceService: workspaces, sessionsRepository: repository }
);

/**
 * Captures one complete service flow and records its boundary even when startup fails.
 */
async function trace(name, operation) {
  const result = { name, started: performance.now(), spans: [] };
  results.push(result);
  try {
    return await context.run(result, operation);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    result.totalMs = performance.now() - result.started;
    result.finished = true;
    process.stderr.write(`${name}: ${result.totalMs.toFixed(1)} ms\n`);
  }
}

try {
  for (let sample = 1; sample <= samples; sample++) {
    const session = await trace(`${mode === 'draft' ? 'new-draft' : 'new'}.${sample}`, async () => {
      const created = await measure('service.create', () =>
        mode === 'draft'
          ? service.prepareDraftSession(workspaceId, randomUUID())
          : service.createSession(workspaceId, 'Startup diagnostic')
      );
      await measure('service.bootstrap', () => service.getBootstrap(created.id));
      return created;
    });
    const binding = runtime.getBindingBySessionId(session.id);
    await runtime.stop(binding.runtimeId);
    await trace(`cold-load.${sample}`, () => service.getBootstrap(session.id));
    await trace(`warm-load.${sample}`, () => service.getBootstrap(session.id));
    await runtime.stop(runtime.getBindingBySessionId(session.id).runtimeId);
  }
} finally {
  await service.closeDrafts();
  await runtime.close();
  database.sqlite.close();
  for (const restore of restorations.reverse()) restore();
  if (dirname(root) !== resolve(tmpdir()) || !root.startsWith(join(tmpdir(), 'octopus-session-profile-'))) {
    throw new Error('Refusing cleanup outside the diagnostic temporary directory');
  }
  await rm(root, { recursive: true, force: true });
  const report = JSON.stringify(
    {
      workspaceId,
      samples,
      mode,
      node: process.version,
      results: results.map(({ started: _started, finished: _finished, ...result }) => result),
    },
    null,
    2
  );
  if (process.argv[4]) await writeFile(resolve(process.argv[4]), `${report}\n`);
  else process.stdout.write(`${report}\n`);
}
