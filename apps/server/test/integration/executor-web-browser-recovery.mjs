/**
 * @author Codex
 * @description Drives real Worker replacement, missing-receiver recovery and site-permission changes through finite Web MCP decisions in an owned browser profile.
 */
import assert from 'node:assert/strict';

/**
 * Keeps browser lifecycle controls in the fixture; all product observations and actions are yielded to the actual Web Agent.
 */
export function createWebBrowserRecovery({
  context,
  expect,
  extensionId,
  browserName,
  readHostProcesses,
  clicks,
}) {
  const evidence = {};

  /**
   * Reads the currently live extension Worker rather than retaining a destroyed Worker after replacement.
   */
  async function storage() {
    const worker = context.serviceWorkers().find((item) => item.url().includes(extensionId));
    if (!worker) return undefined;
    try {
      return await worker.evaluate(async () =>
        globalThis.chrome.storage.local.get(['bridgeStatus', 'installationId'])
      );
    } catch (error) {
      if (/Target closed|has been closed|Execution context was destroyed/.test(error.message))
        return undefined;
      throw error;
    }
  }

  /**
   * Requires the previously observed Host pair to exit, then records the actual replacement pair after handshake.
   */
  async function replaced(previous) {
    await expect
      .poll(
        async () => {
          const current = await readHostProcesses();
          return current.filter((item) => previous.some((old) => old.ProcessId === item.ProcessId)).length;
        },
        { timeout: 20000 }
      )
      .toBe(0);
    await expect.poll(async () => (await storage())?.bridgeStatus, { timeout: 70000 }).toBe('connected');
    const current = await readHostProcesses();
    assert.equal(current.length, 2);
    const launcher = current.find((item) => item.Name === 'browser-launcher.exe');
    const node = current.find((item) => item.Name === 'node.exe');
    assert.ok(launcher && node);
    assert.equal(node.ParentProcessId, launcher.ProcessId);
    return current;
  }

  /**
   * Verifies stale-task refusal, exact source injection and denied actions without replacing production control methods.
   */
  async function* steps({ task, connection, tabId, page, snapshot, target, url }) {
    const installationId = (await storage()).installationId;
    const original = await readHostProcesses();
    const control = await context.newCDPSession(page);
    try {
      await control.send('ServiceWorker.enable');
      await control.send('ServiceWorker.stopAllWorkers');
    } finally {
      await control.detach();
    }
    const restartedHost = await replaced(original);
    assert.equal((await storage()).installationId, installationId);
    const afterRestart = yield { tool: 'browser_list', args: {} };
    const restarted = afterRestart.connections.filter((item) => item.state === 'connected');
    assert.equal(restarted.length, 1);
    assert.notEqual(restarted[0].connectionId, connection);
    yield {
      tool: 'browser_snapshot',
      args: { taskId: task.taskId, tabId },
      expectedError: 'BROWSER_OFFLINE',
    };
    yield { tool: 'task_stop', args: { taskId: task.taskId } };
    const nextTask = yield {
      tool: 'task_start',
      args: {
        capabilities: ['browser'],
        connectionId: restarted[0].connectionId,
        idempotencyKey: 'web-restarted-task',
      },
    };
    const restored = yield { tool: 'browser_snapshot', args: { taskId: nextTask.taskId, tabId } };
    assert.notEqual(restored.controllerId, snapshot.controllerId);
    yield {
      tool: 'browser_click',
      args: {
        taskId: nextTask.taskId,
        tabId,
        target: target(snapshot, 'Fixture click'),
        idempotencyKey: 'web-old-controller',
      },
      expectedError: 'SNAPSHOT_EXPIRED',
    };
    assert.equal(clicks(), 1);
    evidence.workerRestart = {
      installationPreserved: true,
      connectionChanged: true,
      controllerChanged: true,
      oldTaskRejected: true,
      oldReferenceRejected: true,
      previousHostExited: true,
      previousHost: original,
      replacementHost: restartedHost,
    };
    console.log(JSON.stringify({ stage: 'worker-recovery-verified', evidence: evidence.workerRestart }));

    const management = await context.newPage();
    try {
      await management.goto(browserName === 'edge' ? 'edge://extensions' : 'chrome://extensions');
      const ownExtension =
        browserName === 'edge'
          ? management.getByRole('listitem').filter({ hasText: 'Octopus Browser Bridge' })
          : management.locator('extensions-item').filter({ hasText: 'Octopus Browser Bridge' });
      const toggle = ownExtension.locator(
        browserName === 'edge' ? 'fluent-switch.toggle-switch' : '#enableToggle'
      );
      const beforeDisable = await readHostProcesses();
      await toggle.click();
      await expect.poll(async () => (await readHostProcesses()).length, { timeout: 20000 }).toBe(0);
      yield {
        tool: 'browser_snapshot',
        args: { taskId: nextTask.taskId, tabId },
        expectedError: 'BROWSER_OFFLINE',
      };
      await toggle.click();
      const enabledHost = await replaced(beforeDisable);
      assert.equal((await storage()).installationId, installationId);
      const afterEnable = yield { tool: 'browser_list', args: {} };
      const enabled = afterEnable.connections.filter((item) => item.state === 'connected');
      assert.equal(enabled.length, 1);
      assert.notEqual(enabled[0].connectionId, restarted[0].connectionId);
      yield { tool: 'task_stop', args: { taskId: nextTask.taskId } };
      const worker = context.serviceWorkers().find((item) => item.url().includes(extensionId));
      const hasReceiver = await worker.evaluate(
        async ({ tabId, connectionId }) => {
          try {
            await globalThis.chrome.tabs.sendMessage(
              tabId,
              { type: 'page.ping', connectionId },
              { frameId: 0 }
            );
            return true;
          } catch (error) {
            if (/Receiving end does not exist|Could not establish connection/.test(error.message))
              return false;
            throw error;
          }
        },
        { tabId, connectionId: enabled[0].connectionId }
      );
      assert.equal(hasReceiver, false, 'The real document must have no extension receiver before recovery');
      const injectedTask = yield {
        tool: 'task_start',
        args: {
          capabilities: ['browser'],
          connectionId: enabled[0].connectionId,
          idempotencyKey: 'web-injection-task',
        },
      };
      const common = { taskId: injectedTask.taskId };
      const debug = await context.newCDPSession(page);
      let injections = 0;
      debug.on('Debugger.scriptParsed', (event) => {
        if (event.url.endsWith('/content-scripts/content.js')) injections++;
      });
      let injected;
      try {
        await debug.send('Debugger.enable');
        injections = 0;
        injected = yield { tool: 'browser_snapshot', args: { ...common, tabId } };
        assert.equal(injections, 1, 'Recovery must inject the fixed content script exactly once');
      } finally {
        await debug.detach();
      }
      assert.notEqual(injected.controllerId, restored.controllerId);
      assert.equal(clicks(), 1);
      evidence.reinjection = {
        receiverMissing: true,
        injections,
        controllerChanged: true,
        previousHostExited: true,
        previousHost: beforeDisable,
        replacementHost: enabledHost,
      };
      console.log(JSON.stringify({ stage: 'source-reinjection-verified', evidence: evidence.reinjection }));

      if (browserName === 'edge') {
        // This installed Edge uses the inspected Fluent zh-CN management UI, not Chrome's custom elements.
        await ownExtension.locator('fluent-button').first().click();
        await expect(ownExtension).toHaveCount(0);
      } else await ownExtension.locator('#detailsButton').click();
      /**
       * Selects the actual browser-management permission control; never writes browser preferences or fabricates permission state.
       */
      async function setSiteAccess(mode) {
        if (browserName === 'edge') {
          await management.getByRole('combobox').click();
          await management
            .getByText(mode === 'ON_CLICK' ? '单击时' : '在所有站点上', { exact: true })
            .click();
        } else {
          await management
            .locator('extensions-runtime-host-permissions')
            .locator('#hostAccess')
            .selectOption(mode);
        }
      }
      await setSiteAccess('ON_CLICK');
      yield {
        tool: 'browser_click',
        args: {
          ...common,
          tabId,
          target: target(injected, 'Fixture click'),
          idempotencyKey: 'web-permission-denied',
        },
        expectedError: 'FORBIDDEN_PAGE',
      };
      assert.equal(clicks(), 1);
      await setSiteAccess('ON_ALL_SITES');
      const permitted = yield { tool: 'browser_snapshot', args: { ...common, tabId } };
      yield {
        tool: 'browser_click',
        args: {
          ...common,
          tabId,
          target: target(permitted, 'Fixture click'),
          idempotencyKey: 'web-permitted-click',
        },
      };
      await expect.poll(clicks).toBe(2);
      evidence.sitePermission = { denied: 'FORBIDDEN_PAGE', deniedActionEffects: 0, restoredClickEffects: 1 };
      console.log(JSON.stringify({ stage: 'site-permission-verified', evidence: evidence.sitePermission }));
      yield {
        tool: 'browser_close_tab',
        args: { ...common, tabId, idempotencyKey: 'web-foreign-close' },
        expectedError: 'FORBIDDEN',
      };
      const own = yield {
        tool: 'browser_open_tab',
        args: { ...common, url: url + '/recovered', idempotencyKey: 'web-recovered-open' },
      };
      yield {
        tool: 'browser_close_tab',
        args: { ...common, tabId: own.tabId, idempotencyKey: 'web-recovered-close' },
      };
      const tabs = yield { tool: 'browser_tabs', args: { connectionId: enabled[0].connectionId } };
      assert.equal(
        tabs.tabs.some((item) => item.tabId === own.tabId),
        false
      );
      assert.equal(
        tabs.tabs.some((item) => item.tabId === tabId),
        true
      );
      yield { tool: 'task_end', args: common };
      evidence.tabOwnershipPreserved = true;
    } finally {
      await management.close();
    }
  }
  return { steps, evidence: () => evidence };
}
