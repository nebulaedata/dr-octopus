/**
 * @author Codex
 * @description Verifies that cancelled callers cannot orphan shared RPC failures or poison subsequent retries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForRuntime } from '../dist/infrastructure/runtime/deadline.js';

for (const reason of ['cancelled', 'expired', 'zero-budget']) {
  test(`an already ${reason} caller still observes a later shared rejection`, async () => {
    const controller = new AbortController();
    if (reason === 'cancelled') controller.abort();
    const options = { signal: controller.signal, ...(reason === 'expired' ? { deadlineAt: 0 } : {}) };
    let rejectWork;
    const work = new Promise((_resolve, reject) => {
      rejectWork = reject;
    });
    await assert.rejects(
      waitForRuntime(work, options, reason === 'zero-budget' ? 0 : 1000, Date.now, 'test'),
      {
        code: reason === 'cancelled' ? 'SESSION_RUNTIME_CANCELLED' : 'SESSION_RUNTIME_TIMEOUT',
      }
    );
    rejectWork(new Error('late RPC failure'));
    await delay(0);
    assert.equal(
      await waitForRuntime(Promise.resolve('retry succeeded'), {}, 1000, Date.now, 'retry'),
      'retry succeeded'
    );
  });
}

test('one cancelled waiter does not discard the result or error owned by another waiter', async () => {
  for (const failed of [false, true]) {
    let resolveWork, rejectWork;
    const work = new Promise((resolve, reject) => {
      resolveWork = resolve;
      rejectWork = reject;
    });
    const controller = new AbortController();
    const cancelled = waitForRuntime(work, { signal: controller.signal }, 1000, Date.now, 'cancelled');
    const active = waitForRuntime(work, {}, 1000, Date.now, 'active');
    controller.abort();
    await assert.rejects(cancelled, { code: 'SESSION_RUNTIME_CANCELLED' });
    if (failed) {
      const failure = new Error('RPC failure');
      rejectWork(failure);
      await assert.rejects(active, (error) => error === failure);
    } else {
      resolveWork('shared result');
      assert.equal(await active, 'shared result');
    }
  }
});

test('a late real get_state timeout cannot terminate the Host after the caller cancelled', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-rpc-timeout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const silentAgent = join(root, 'silent-agent.mjs');
  await writeFile(
    silentAgent,
    `
    import { createInterface } from 'node:readline';
    createInterface({ input: process.stdin }).on('line', (line) => {
      if (process.env.MOCK_RPC_RESPOND !== 'yes') return;
      const command = JSON.parse(line);
      const data = command.type === 'get_state'
        ? { isStreaming: false, isCompacting: false, pendingMessageCount: 0, sessionId: 'test' }
        : { commands: [] };
      process.stdout.write(JSON.stringify({ id: command.id, type: 'response', command: command.type, success: true, data }) + '\\n');
    });
  `
  );
  const deadlineUrl = new URL('../dist/infrastructure/runtime/deadline.js', import.meta.url).href;
  const source = `
    import assert from 'node:assert/strict';
    import { setTimeout as delay } from 'node:timers/promises';
    import { AgentRpcProcess } from '@octopus/agent/rpc';
    import { waitForRuntime } from ${JSON.stringify(deadlineUrl)};
    const rpc = new AgentRpcProcess({ workspace: { id: 'isolated', cwd: ${JSON.stringify(root)} }, entryPath: ${JSON.stringify(silentAgent)}, requestTimeoutMs: 100, stopTimeoutMs: 500 });
    try {
      const stopped = new Promise(resolve => {
        const unsubscribe = rpc.onLifecycle(event => {
          if (event.type === 'stopped') { unsubscribe(); resolve(); }
        });
      });
      const work = rpc.start();
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(waitForRuntime(work, { signal: controller.signal }, 1000, Date.now, 'activation'), { code: 'SESSION_RUNTIME_CANCELLED' });
      await stopped;
      await delay(0);
      await assert.rejects(work, { code: 'RPC_TIMEOUT', command: 'get_state' });
      const retry = new AgentRpcProcess({ workspace: { id: 'isolated', cwd: ${JSON.stringify(root)} }, entryPath: ${JSON.stringify(silentAgent)}, requestTimeoutMs: 2000, childEnvironment: { MOCK_RPC_RESPOND: 'yes' } });
      try {
        await waitForRuntime(retry.start(), {}, 5000, Date.now, 'retry');
        assert.equal(retry.getState(), 'ready');
        assert.equal((await retry.execute({ type: 'get_state' })).success, true);
      } finally { await retry.stop(); }
      console.log('Host survived');
    } finally { await rpc.stop(); }
  `;
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    ['--unhandled-rejections=strict', '--input-type=module', '--eval', source],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, timeout: 10000 }
  );
  assert.match(stdout, /Host survived/);
  assert.equal(stderr, '');
});
