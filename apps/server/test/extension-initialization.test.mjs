/**
 * @author Codex
 * @description Verifies offline startup degradation and cancellation of the dedicated extension installer.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeExtensions } from '../dist/lib/startup/extension-initialization.js';

test('Offline extension initialization reports every missing source without npm installation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-offline-extensions-'));
  const previous = process.env.NPM_CONFIG_REGISTRY;
  process.env.NPM_CONFIG_REGISTRY = 'http://127.0.0.1:9';
  t.after(async () => {
    if (previous === undefined) {
      delete process.env.NPM_CONFIG_REGISTRY;
    } else {
      process.env.NPM_CONFIG_REGISTRY = previous;
    }
    await rm(directory, { recursive: true, force: true });
  });
  const result = await initializeExtensions(directory, new AbortController().signal);
  assert.equal(result.installed.length, 0);
  assert.ok(result.failures.length > 0);
  assert.ok(result.failures.every((failure) => failure.networkUnavailable));
});

test('Cancelling startup closes the owned installer process', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-cancel-extensions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  const pending = initializeExtensions(directory, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});

test('Agent JSON configures the isolated installer without injecting credentials into Server', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-configured-extensions-'));
  const previous = process.env.NPM_CONFIG_REGISTRY;
  delete process.env.NPM_CONFIG_REGISTRY;
  let probes = 0;
  const registry = createServer((_request, response) => {
    probes += 1;
    response.writeHead(503).end();
  });
  await new Promise((resolve) => registry.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    registry.closeAllConnections();
    await new Promise((resolve) => registry.close(resolve));
    if (previous === undefined) delete process.env.NPM_CONFIG_REGISTRY;
    else process.env.NPM_CONFIG_REGISTRY = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${registry.address().port}`;
  await writeFile(join(directory, 'environment.json'), JSON.stringify({ NPM_CONFIG_REGISTRY: url }));
  const result = await initializeExtensions(directory, new AbortController().signal);
  assert.equal(probes, 1);
  assert.ok(result.failures.length > 0);
  assert.equal(process.env.NPM_CONFIG_REGISTRY, undefined);
});
