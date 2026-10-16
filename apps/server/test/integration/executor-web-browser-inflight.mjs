/**
 * @author Codex
 * @description Holds actual Native Host result delivery in an isolated copy after page execution, and verifies Web cancellation, revocation and unknown outcomes without replay.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Creates a finite reply barrier; its fetch shim is written only to the fixture-owned Host copy.
 */
export function createWebBrowserInflight(options) {
  const { data, expect, clicks } = options;
  const mode = process.env.EXECUTOR_WEB_BROWSER_FAULT ?? 'timeout';
  assert.ok(['timeout', 'disconnect', 'cancel', 'revoke'].includes(mode));
  let armed = false;
  let held;
  let observed = false;
  let baseline;
  let taskId;
  let connectionId;
  let operationKey;
  let outcome;

  /**
   * Restricts interception to one actual result, without publishing credentials or changing its contents.
   */
  function hostShim(url) {
    return `(() => {
      const original = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (options?.method === 'POST' && options.body) {
          const message = JSON.parse(options.body);
          if (message.type === 'result') {
            const gate = await original(${JSON.stringify(url + '/result-barrier')}, {
              method: 'POST', signal: AbortSignal.timeout(22000)
            });
            if ((await gate.json()).drop) throw new Error('Owned reply barrier dropped delivery');
          }
        }
        return original(url, options);
      };
    })();\n`;
  }

  /**
   * Receives only barrier notifications, never Native Messaging payloads or role credentials.
   */
  function handle(request, response) {
    if (request.url !== '/result-barrier') return false;
    if (!armed) response.end(JSON.stringify({ drop: false }));
    else {
      assert.equal(held, undefined, 'Exactly one reply may enter the armed barrier');
      armed = false;
      held = response;
      console.log(JSON.stringify({ stage: 'browser-result-held', mode, taskId, operationKey }));
    }
    return true;
  }

  /**
   * Reads complete immutable journal events, excluding an unfinished final append.
   */
  async function task() {
    const text = await readFile(join(data, '.octopus-executor-recovery-control/events.jsonl'), 'utf8');
    return text
      .slice(0, text.lastIndexOf('\n'))
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse)
      .filter((item) => item.kind === 'task' && item.value.taskId === taskId)
      .at(-1)?.value;
  }

  /**
   * Releases the exact intercepted reply; a dropped reply still leaves its already executed page effect intact.
   */
  function release(drop = false) {
    held?.end(JSON.stringify({ drop }));
  }

  /**
   * Triggers a real lifecycle/control event only after the source has produced an actual result and page effect.
   */
  async function observe(webPage, executorPage) {
    if (!held || observed) return;
    observed = true;
    await expect.poll(clicks).toBe(baseline + 1);
    if (mode === 'cancel') {
      await webPage.getByRole('button', { name: 'Stop current run', exact: true }).click();
      await expect.poll(async () => (await task())?.state).toBe('stopping');
      release();
    } else if (mode === 'revoke') {
      // Revocation waits for in-flight completion; do not await the button handler before releasing it.
      const revoke = executorPage.getByRole('button', { name: '撤销', exact: true }).click();
      await expect.poll(async () => (await task())?.state).toBe('stopping');
      release();
      await revoke;
    } else if (mode === 'disconnect') {
      const page = options.context
        .pages()
        .find((item) => item.url().startsWith('http://octopus-browser.test'));
      const debug = await options.context.newCDPSession(page);
      try {
        await debug.send('ServiceWorker.enable');
        await debug.send('ServiceWorker.stopAllWorkers');
      } finally {
        await debug.detach();
      }
      release(true);
      await expect
        .poll(
          async () => {
            const access = await executorPage.evaluate(() => globalThis.executor.readAccess());
            return access.data.browser.connections.some(
              (item) => item.state === 'connected' && item.connectionId !== connectionId
            );
          },
          { timeout: 70000 }
        )
        .toBe(true);
    } else {
      await expect
        .poll(async () => (await task())?.operations.find((item) => item.key === operationKey)?.state, {
          timeout: 20000,
        })
        .toBe('unknown');
      release(true);
    }
  }

  /**
   * Arms only the final explicit click, keeping all earlier Browser observations and decisions unchanged.
   */
  async function* steps({ task: current, connection, tabId, snapshot, target }) {
    taskId = current.taskId;
    connectionId = connection;
    baseline = clicks();
    operationKey = 'web-browser-inflight-' + mode;
    armed = true;
    yield {
      tool: 'browser_click',
      args: { taskId, tabId, target: target(snapshot, 'Fixture click'), idempotencyKey: operationKey },
      ...(mode === 'timeout' || mode === 'disconnect' ? { expectedError: 'OUTCOME_UNKNOWN' } : {}),
      ...(mode === 'revoke' ? { expectedAdapterError: true } : {}),
    };
    if (mode === 'revoke' || mode === 'cancel') return;
    const status = yield { tool: 'task_status', args: { taskId, operationKey } };
    assert.equal(status.operation.state, 'unknown');
    assert.equal(status.operation.effect, 'unknown');
    yield {
      tool: 'browser_click',
      args: { taskId, tabId, target: target(snapshot, 'Fixture click'), idempotencyKey: operationKey },
      expectedError: 'OPERATION_RETAINED',
    };
    yield { tool: 'task_stop', args: { taskId } };
    yield {
      tool: 'browser_click',
      args: {
        taskId,
        tabId,
        target: target(snapshot, 'Fixture click'),
        idempotencyKey: operationKey + '-after-stop',
      },
      expectedError: 'TASK_INTERRUPTED',
    };
    if (mode === 'disconnect') {
      yield {
        tool: 'task_start',
        args: { capabilities: ['browser'], connectionId, idempotencyKey: operationKey + '-old-connection' },
        expectedError: 'BROWSER_OFFLINE',
      };
      const current = yield { tool: 'browser_list', args: {} };
      const replacement = current.connections.find(
        (item) => item.state === 'connected' && item.connectionId !== connectionId
      );
      assert.ok(replacement);
      const next = yield {
        tool: 'task_start',
        args: {
          capabilities: ['browser'],
          connectionId: replacement.connectionId,
          idempotencyKey: operationKey + '-replacement',
        },
      };
      yield {
        tool: 'browser_click',
        args: {
          taskId: next.taskId,
          tabId,
          target: target(snapshot, 'Fixture click'),
          idempotencyKey: operationKey + '-old-reference',
        },
        expectedError: 'SNAPSHOT_EXPIRED',
      };
      yield { tool: 'task_end', args: { taskId: next.taskId } };
    }
  }

  /**
   * Verifies durable outcomes after stop/revoke or unknown delivery; one source effect is never rolled back or replayed.
   */
  async function verify() {
    assert.equal(observed, true);
    await expect.poll(async () => (await task())?.state, { timeout: 20000 }).toBe('cancelled');
    const record = await task();
    const operation = record.operations.find((item) => item.key === operationKey);
    assert.equal(operation.state, mode === 'cancel' || mode === 'revoke' ? 'completed' : 'unknown');
    assert.equal(clicks(), baseline + 1);
    outcome = {
      mode,
      taskId,
      connectionId,
      operationKey,
      state: operation.state,
      effect: operation.effect,
      taskState: record.state,
      sourceResultObserved: true,
      effectCount: 1,
      replayed: false,
    };
    console.log(JSON.stringify({ stage: 'browser-inflight-verified', ...outcome }));
    return outcome;
  }

  /**
   * Bounds cleanup even if a failed test abandons the intercepted result.
   */
  function close() {
    release(true);
  }
  return {
    hostShim,
    handle,
    observe,
    steps,
    verify,
    close,
    cancelled: () => mode === 'cancel' && observed,
    evidence: () => outcome,
  };
}
