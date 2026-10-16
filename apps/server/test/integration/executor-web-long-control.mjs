/**
 * @author Codex
 * @description Observes a fixture-owned private Node child and verifies real Web abort or Executor authorization revocation against persisted task and Job outcomes.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeCommand } from '../../../executor/test/fixtures/shell-command.mjs';

/**
 * Reads only complete append records while the unique Runtime writer remains live.
 */
async function journal(path) {
  const text = await readFile(path, 'utf8');
  return text
    .slice(0, text.lastIndexOf('\n'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Inspects the previously observed fixture PID without terminating or enumerating unrelated processes.
 */
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * Binds evidence to this fixture's workspace and private data, with no production control API additions.
 */
export function createWebLongControlFixture({ mode, workspace, data, expect, proxy }) {
  let interrupted = false;
  let pid;
  let interruptedAt;
  const command = nodeCommand(
    `const fs=require("node:fs");fs.appendFileSync("web-control-started.txt","start\\n");fs.writeFileSync("web-control-pid.txt",String(process.pid));setTimeout(()=>fs.writeFileSync("web-control-completed.txt","finished"),${mode === 'disconnect' ? 5000 : 75000})`
  );

  /**
   * Acts only after the actual private Node child has published startup evidence.
   */
  async function observe(webPage, executorPage) {
    if (interrupted) return;
    try {
      pid = Number(await readFile(join(workspace, 'web-control-pid.txt'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    assert.ok(Number.isSafeInteger(pid) && pid > 0 && running(pid));
    interruptedAt = Date.now();
    if (mode === 'cancel') {
      await webPage.getByRole('button', { name: 'Stop current run', exact: true }).click();
    } else if (mode === 'disconnect') {
      proxy.dropReply();
    } else {
      await executorPage.getByRole('button', { name: '撤销', exact: true }).click();
      await expect
        .poll(
          async () =>
            (await executorPage.evaluate(() => globalThis.executor.readAccess())).data.clients[0].revoked
        )
        .toBe(true);
    }
    interrupted = true;
  }

  /**
   * Waits for the original action to finish without emitting another action or fabricating its result.
   */
  async function waitForCompletion(taskId) {
    const path = join(data, '.octopus-executor-recovery-control/events.jsonl');
    await expect
      .poll(
        async () =>
          (await journal(path))
            .filter((item) => item.kind === 'task' && item.value.taskId === taskId)
            .at(-1)
            ?.value.operations.find((item) => item.key === 'web-session-powershell')?.state,
        { timeout: 15000 }
      )
      .toBe('completed');
  }

  /**
   * Requires OS quiescence, durable cancellation and no completion/replay; UI idle alone cannot pass.
   */
  async function verify(taskId, webPage) {
    assert.equal(interrupted, true);
    await expect.poll(() => running(pid), { timeout: 10000 }).toBe(false);
    const control = join(data, '.octopus-executor-recovery-control/events.jsonl');
    await expect
      .poll(
        async () =>
          (await journal(control))
            .filter((item) => item.kind === 'task' && item.value.taskId === taskId)
            .at(-1)?.value.state,
        { timeout: 10000 }
      )
      .toBe(mode === 'disconnect' ? 'completed' : 'cancelled');
    const task = (await journal(control))
      .filter((item) => item.kind === 'task' && item.value.taskId === taskId)
      .at(-1).value;
    assert.equal(task.quarantined, false);
    const operation = task.operations.find((item) => item.key === 'web-session-powershell');
    assert.equal(operation.state, 'completed');
    const historyRoot = join(data, '.octopus-executor-recovery-shell');
    const records = [];
    for (const name of await readdir(historyRoot)) {
      if (/^[a-f0-9-]{36}\.jsonl$/.test(name)) records.push(...(await journal(join(historyRoot, name))));
    }
    const outcome = records
      .filter((item) => item.taskId === taskId && item.key === 'web-session-powershell')
      .at(-1);
    assert.equal(outcome.result.terminationReason, mode === 'disconnect' ? 'completed' : 'cancelled');
    assert.equal(outcome.result.executionState, 'quiescent');
    assert.equal(
      outcome.result.businessEffect,
      'unknown',
      'Stopping does not undo previously applied effects'
    );
    assert.equal(await readFile(join(workspace, 'web-control-started.txt'), 'utf8'), 'start\n');
    if (mode === 'disconnect') {
      assert.equal(await readFile(join(workspace, 'web-control-completed.txt'), 'utf8'), 'finished');
      assert.deepEqual(proxy.evidence(), { dropped: true, shellRequests: 2, cancellationNotifications: 0 });
    } else await assert.rejects(readFile(join(workspace, 'web-control-completed.txt')), { code: 'ENOENT' });
    if (mode === 'cancel')
      await expect(webPage.getByRole('button', { name: 'Stop current run', exact: true })).toBeHidden();
    return {
      mode,
      pid,
      childExited: true,
      elapsedAfterInterruptionMs: Date.now() - interruptedAt,
      taskState: task.state,
      terminationReason: outcome.result.terminationReason,
      executionState: outcome.result.executionState,
      businessEffect: outcome.result.businessEffect,
      starts: 1,
      completedMarker: mode === 'disconnect',
      ...(proxy ? { transportEvidence: proxy.evidence() } : {}),
    };
  }
  return { command, observe, verify, waitForCompletion, wasInterrupted: () => interrupted };
}
