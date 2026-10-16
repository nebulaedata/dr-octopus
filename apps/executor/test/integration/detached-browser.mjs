/**
 * @author Codex
 * @description Owns an isolated Chromium process and browser-level CDP channel without auto-attaching to website targets.
 */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Launches an owned profile; only explicitly evaluated control targets receive a temporary debugger session.
 */
export async function launchDetachedBrowser(profile, extension, browserName, options = {}) {
  const flavor = options.flavor ?? process.env.EXECUTOR_BROWSER_FLAVOR ?? 'chromium';
  assert.ok(['chromium', 'installed'].includes(flavor), 'Unknown browser validation flavor.');
  let executable = join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1228/chrome-win64/chrome.exe');
  if (flavor === 'installed') {
    executable =
      browserName === 'chrome'
        ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
        : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
  }
  const child = spawn(
    executable,
    [
      '--user-data-dir=' + profile,
      '--remote-debugging-port=0',
      ...(flavor === 'installed'
        ? ['--enable-unsafe-extension-debugging']
        : ['--disable-extensions-except=' + extension, '--load-extension=' + extension]),
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=-2000,-2000',
      '--host-resolver-rules=MAP octopus-browser.test 127.0.0.1',
      '--no-proxy-server',
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore', env: options.environment ?? process.env }
  );
  let socket;
  let spawnError;
  let sequence = 0;
  const pending = new Map();
  const exited = new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', (error) => {
      spawnError = error;
      resolve();
    });
  });
  /**
   * Closes only this fixture's process, falling back to its owned PID tree after a finite deadline.
   */
  async function close() {
    if (socket?.readyState === WebSocket.OPEN) {
      await send('Browser.close').catch(() => {});
      socket.close();
    }
    if (!spawnError && child.exitCode === null && child.signalCode === null) {
      const deadline = Date.now() + 5000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (child.exitCode === null && child.signalCode === null) {
        await promisify(execFile)(
          join(process.env.SystemRoot, 'System32/taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, timeout: 5000 }
        );
      }
    }
    await exited;
  }
  /**
   * Correlates bounded CDP requests on the owned channel; product traffic never uses this helper.
   */
  function send(method, params = {}, sessionId) {
    if (socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Owned browser channel unavailable.'));
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Owned CDP deadline: ' + method));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  /**
   * Evaluates one fixture expression and detaches immediately, including on a JavaScript failure.
   */
  async function evaluate(targetId, expression) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    try {
      const reply = await send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId
      );
      assert.equal(reply.exceptionDetails, undefined, JSON.stringify(reply.exceptionDetails));
      return reply.result.value;
    } finally {
      await send('Target.detachFromTarget', { sessionId });
    }
  }
  /**
   * Explicitly removes the internal debug page's forced freeze after refusal has already been verified without attachment.
   */
  async function resume(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    try {
      await send('Page.setWebLifecycleState', { state: 'active' }, sessionId);
    } finally {
      await send('Target.detachFromTarget', { sessionId });
    }
  }
  try {
    const deadline = Date.now() + (options.startupTimeoutMs ?? 10000);
    let address;
    while (Date.now() < deadline) {
      if (spawnError) {
        throw spawnError;
      }
      try {
        const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8'))
          .trim()
          .split(/\r?\n/);
        address = 'ws://127.0.0.1:' + port + path;
        break;
      } catch (error) {
        // Chromium may briefly deny sharing while publishing its own port file on Windows.
        if (!['ENOENT', 'EBUSY'].includes(error.code)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(address, 'Owned browser must expose its local debugging channel.');
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned CDP connect deadline.')), 10000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('Owned CDP connect failed.'));
        },
        { once: true }
      );
    });
    socket.addEventListener('message', (event) => {
      const reply = JSON.parse(event.data);
      const request = pending.get(reply.id);
      if (!request) {
        return;
      }
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.error) {
        request.reject(new Error(JSON.stringify(reply.error)));
      } else {
        request.resolve(reply.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Owned browser channel closed.'));
      }
      pending.clear();
    });
    if (flavor === 'installed') {
      const loaded = await send('Extensions.loadUnpacked', { path: extension });
      const { identity } = JSON.parse(await readFile(join(extension, 'browser-identity.json'), 'utf8'));
      assert.equal(loaded.id, identity.sideloadExtensionId);
    }
    return { send, evaluate, resume, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], error.message + '; owned browser cleanup also failed', {
        cause: cleanup,
      });
    }
    throw error;
  }
}
