/**
 * @author Codex
 * @description Verifies fatal installation failures and explicit cancellation of the dedicated extension installer.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeExtensions } from '../dist/lib/startup/extension-initialization.js';

test('Cancelling startup closes the owned installer process', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-cancel-extensions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  const pending = initializeExtensions(directory, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});

test('Installation failure rejects startup using the isolated Agent registry configuration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-configured-extensions-'));
  const previous = process.env.NPM_CONFIG_REGISTRY;
  delete process.env.NPM_CONFIG_REGISTRY;
  let probes = 0;
  const registry = createServer((_request, response) => {
    probes += 1;
    response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
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
  await assert.rejects(
    initializeExtensions(directory, new AbortController().signal),
    /npm:.*rpiv-ask-user-question/
  );
  assert.ok(probes > 0);
  assert.equal(process.env.NPM_CONFIG_REGISTRY, undefined);
});
