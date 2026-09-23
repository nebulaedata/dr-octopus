/**
 * @author Codex
 * @description Verifies real HTTP response handoff and operation replay across a listening runtime replacement.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import test from 'node:test';
import { createServerHost } from '../dist/host.js';
import { createServerEnvironmentStore } from '../dist/infrastructure/config/environment.js';
import { ServerConfiguration } from '../dist/modules/server-settings/server-settings.service.js';
import { ServerSettingsService } from '../dist/modules/server-settings/server-settings.service.js';
import { registerServerSettingsController } from '../dist/modules/server-settings/server-settings.controller.js';

test(
  'HTTP returns 202 before close and the replacement serves the same operation record',
  { timeout: 15_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'octopus-host-http-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const environment = { SERVER_DATA_DIR: directory, SERVER_PORT: String(port) };
    const store = createServerEnvironmentStore(directory, environment);
    let created = 0;
    const host = createServerHost({
      prepare: () => {
        const { revision, values, persisted } = store.load();
        return { revision, values, persisted };
      },
      apply() {},
      createRuntime({ config, control }) {
        created++;
        const app = Fastify();
        const configuration = new ServerConfiguration(directory, control, environment);
        registerServerSettingsController(
          app,
          new ServerSettingsService(config, configuration, control, () => ({
            state: control.state(),
            address: app.listeningOrigin,
            activeRuntimeCount: 0,
            fileLogging: { enabled: false, state: 'disabled', directory },
          })),
          control
        );
        return {
          start: async () => {
            await app.listen({ host: config.host, port: config.port });
          },
          close: () => app.close(),
          getStatus: () => ({
            state: 'running',
            phase: 'ready',
            address: app.listeningOrigin,
            dataDir: directory,
            fileLogging: { enabled: false, state: 'disabled', directory },
            warnings: [],
          }),
        };
      },
    });
    t.after(() => host.stop());
    await host.start();
    const url = `http://127.0.0.1:${port}/settings/server`;
    const settings = await (await fetch(url)).json();
    const body = { revision: settings.revision, expectedServiceInstanceId: settings.serviceInstanceId };
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'http-attempt' };
    const response = await fetch(`${url}/restart`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 202);
    const accepted = (await response.json()).operation;
    let operation;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        operation = (await (await fetch(`${url}/restart-operations/${accepted.operationId}`)).json())
          .operation;
      } catch {
        /* The listening socket is intentionally absent during handoff. */
      }
      if (operation?.state === 'succeeded') break;
      await delay(20);
    }
    assert.equal(operation.state, 'succeeded');
    assert.equal(created, 2);
    const replay = await fetch(`${url}/restart`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(replay.status, 202);
    assert.equal((await replay.json()).operation.operationId, accepted.operationId);
    assert.equal(created, 2);
  }
);
