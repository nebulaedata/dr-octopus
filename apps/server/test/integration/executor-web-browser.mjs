/**
 * @author Codex
 * @description Owns an isolated installed browser and test-only Native Host registration, and drives finite Browser decisions through a real Web Agent conversation.
 */
import assert from 'node:assert/strict';
import { cp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWebBrowserRecovery } from './executor-web-browser-recovery.mjs';
import { createWebBrowserInflight } from './executor-web-browser-inflight.mjs';
import { createWebBrowserDom } from './executor-web-browser-dom.mjs';
import { createWebBrowserLifecycle } from './executor-web-browser-lifecycle.mjs';

const browserIdentity = JSON.parse(
  await readFile(
    new URL('../../../browser-extension/.output/chrome-mv3/browser-identity.json', import.meta.url),
    'utf8'
  )
);
const extensionId = browserIdentity.sideloadExtensionId;

/**
 * Reads only published snapshot references; never accesses Controller internals.
 */
function target(snapshot, label) {
  const line = snapshot.text.split('\n').find((value) => value.includes(label) && /\[\d+\]/.test(value));
  assert.ok(line, 'The real snapshot must expose: ' + label);
  return {
    documentId: snapshot.documentId,
    controllerId: snapshot.controllerId,
    snapshotId: snapshot.snapshotId,
    elementIndex: Number(line.match(/\[(\d+)\]/)[1]),
  };
}

/**
 * Allocates fixture resources before launch so even a setup failure has an owned cleanup path.
 */
export function createWebBrowserFixture({ root, data, executorRoot, environment, chromium, expect }) {
  const browserName = process.env.EXECUTOR_WEB_CONTROLLED_BROWSER ?? 'chrome';
  assert.ok(['chrome', 'edge'].includes(browserName));
  const host = 'com.octopus.executor.web_test_' + randomUUID().replaceAll('-', '');
  const resource = join(root, 'browser-host');
  const extension = join(root, 'extension');
  const manifest = join(resource, 'bridge/native-host.json');
  const registryScript = join(root, 'register-test-host.ps1');
  let registered = false;
  let context;
  let worker;
  let fixturePage;
  let clicks = 0;
  let completed = false;
  let version;
  let pagesRead = 0;
  let hostProcesses = [];
  let recovery;
  const check = process.env.EXECUTOR_WEB_BROWSER_CHECK ?? 'none';
  assert.ok(['none', 'recovery', 'inflight', 'dom', 'lifecycle'].includes(check));
  const lifecycle =
    check === 'lifecycle'
      ? createWebBrowserLifecycle({
          root,
          extensionId,
          browserName,
          expect,
          clicks: () => clicks,
          environment,
        })
      : undefined;
  const dom = check === 'dom' ? createWebBrowserDom({ expect, clicks: () => clicks }) : undefined;
  const inflight =
    check === 'inflight'
      ? createWebBrowserInflight({
          data,
          get context() {
            return context;
          },
          expect,
          clicks: () => clicks,
        })
      : undefined;
  const site = createServer((request, response) => {
    if (inflight?.handle(request, response)) return;
    if (request.url === '/clicked' || request.url?.startsWith('/clicked?trusted=')) {
      clicks++;
      if (lifecycle) {
        console.log(
          JSON.stringify({
            stage: 'web-lifecycle-effect',
            method: request.method,
            trusted: new URL(request.url, 'http://fixture').searchParams.get('trusted'),
            clicks,
          })
        );
      }
      response.end('ok');
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const clickHandler = lifecycle
      ? "fetch('/clicked?trusted='+event.isTrusted,{method:'POST'})"
      : "fetch('/clicked')";
    response.end(
      `<title>Owned Web Browser fixture</title><body style="min-height:4000px"><button onclick="${clickHandler}">Fixture click</button><input aria-label="Fixture input"><select aria-label="Fixture select"><option>One</option><option>Two</option></select><input type="password" value="private-secret-password"><div data-executor-sensitive>private-sensitive-content</div><div style="height:80px;overflow:hidden">${request.url === '/big' ? 'pagination Unicode 中文 '.repeat(1200) : 'fixture text'}</div></body>`
    );
  });

  /**
   * Mutates only the unique test Host key, requiring exact manifest ownership on removal.
   */
  async function register(mode) {
    await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', registryScript, mode],
      {
        windowsHide: true,
        timeout: 10000,
        env: { ...environment, OCTOPUS_TEST_HOST: host, OCTOPUS_TEST_MANIFEST: manifest },
      }
    );
  }

  /**
   * Observes only this copied Host resource's native launcher/private Node process pair.
   */
  async function readHostProcesses() {
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'browser-launcher.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -and $_.CommandLine.Contains($env:OCTOPUS_TEST_RESOURCE) } | Select-Object ProcessId,ParentProcessId,Name) | ConvertTo-Json -Compress",
      ],
      { env: { ...environment, OCTOPUS_TEST_RESOURCE: resource }, timeout: 10000, windowsHide: true }
    );
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  /**
   * Starts the actual launcher/private Node and MV3 bundle; only the copied Host name differs.
   */
  async function start(executorPage) {
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
    for (const path of [
      'native/browser-launcher.exe',
      'native/file-commit.node',
      'bridge/native-host.cjs',
      'resources/node/node.exe',
      'resources/node/LICENSE',
    ]) {
      await mkdir(join(resource, path, '..'), { recursive: true });
      await copyFile(join(executorRoot, 'dist', path), join(resource, path));
    }
    if (lifecycle) {
      const hostPath = join(resource, 'bridge/native-host.cjs');
      const logPath = join(
        process.env.EXECUTOR_WEB_NATIVE_ACTIVATION_EVIDENCE || root,
        'native-transport.jsonl'
      );
      // Record only this fixture's transport metadata; never log endpoints, headers or bodies.
      const shim = `const diagnosticFs=require('node:fs');const diagnosticFetch=globalThis.fetch;
const diagnosticLog=value=>diagnosticFs.appendFileSync(${JSON.stringify(logPath)},JSON.stringify({time:new Date().toISOString(),...value})+'\\n');
globalThis.fetch=async(...args)=>{const method=args[1]?.method;try{const response=await diagnosticFetch(...args);diagnosticLog({method,status:response.status});return response;}catch(error){diagnosticLog({method,name:error.name,code:error.cause?.code});throw error;}};
`;
      await writeFile(hostPath, shim + (await readFile(hostPath, 'utf8')));
    }
    if (inflight) {
      const hostPath = join(resource, 'bridge/native-host.cjs');
      await writeFile(
        hostPath,
        inflight.hostShim('http://127.0.0.1:' + site.address().port) + (await readFile(hostPath, 'utf8'))
      );
    }
    await writeFile(join(resource, 'bridge/host-location.json'), JSON.stringify({ userData: data }));
    await writeFile(
      manifest,
      JSON.stringify({
        name: host,
        description: 'Owned Web acceptance Host',
        path: join(resource, 'native/browser-launcher.exe'),
        type: 'stdio',
        allowed_origins: ['chrome-extension://' + extensionId + '/'],
      })
    );
    await writeFile(
      registryScript,
      `param([ValidateSet('install','remove')][string]$Mode)
$ErrorActionPreference = 'Stop'
if ($env:OCTOPUS_TEST_HOST -notmatch '^com\\.octopus\\.executor\\.web_test_[a-f0-9]{32}$') { throw 'Invalid test Host' }
$key = 'HKCU:\\Software\\' + $(if ('${browserName}' -eq 'chrome') { 'Google\\Chrome' } else { 'Microsoft\\Edge' }) + '\\NativeMessagingHosts\\' + $env:OCTOPUS_TEST_HOST
if ($Mode -eq 'install') {
  if (Test-Path -LiteralPath $key) { throw 'Test Host already registered' }
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $env:OCTOPUS_TEST_MANIFEST
} elseif (Test-Path -LiteralPath $key) {
  if ((Get-Item -LiteralPath $key).GetValue('') -ne $env:OCTOPUS_TEST_MANIFEST) { throw 'Foreign test Host value' }
  Remove-Item -LiteralPath $key
}
`
    );
    await cp(resolve(executorRoot, '../browser-extension/.output/' + browserName + '-mv3'), extension, {
      recursive: true,
    });
    const background = join(extension, 'background.js');
    const source = await readFile(background, 'utf8');
    assert.equal(source.split('com.octopus.executor.browser').length, 2, 'Replace exactly one Host name');
    await writeFile(background, source.replace('com.octopus.executor.browser', host));
    await register('install');
    registered = true;
    await executorPage.getByRole('button', { name: '启用浏览器桥接', exact: true }).click();
    if (lifecycle) version = await lifecycle.start(extension);
    else {
      const executablePath =
        browserName === 'chrome'
          ? join(environment.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
          : join(environment['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe');
      context = await chromium.launchPersistentContext(join(root, 'controlled-browser'), {
        executablePath,
        env: environment,
        headless: false,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
          '--enable-unsafe-extension-debugging',
          '--window-position=-2000,-2000',
          '--host-resolver-rules=MAP octopus-browser.test 127.0.0.1',
          '--no-proxy-server',
        ],
      });
      const channel = await context.browser().newBrowserCDPSession();
      try {
        assert.equal((await channel.send('Extensions.loadUnpacked', { path: extension })).id, extensionId);
        version = (await channel.send('Browser.getVersion')).product;
      } finally {
        await channel.detach();
      }
      worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await expect
        .poll(
          () =>
            worker.evaluate(
              async () => (await globalThis.chrome.storage.local.get('bridgeStatus')).bridgeStatus
            ),
          // Include the production 30-second alarm retry after a cold Host handshake failure.
          { timeout: 70000 }
        )
        .toBe('connected');
    }
    await expect
      .poll(
        async () =>
          (await executorPage.evaluate(() => globalThis.executor.readStatus())).data.capabilities.browser
            .available,
        // Main projects capabilities on its existing five-second health tick; observe multiple ticks, not one boundary.
        { timeout: 15000 }
      )
      .toBe(true);
    hostProcesses = await readHostProcesses();
    assert.equal(hostProcesses.length, 2, 'One native launcher/private Node pair must own the actual bridge');
    const launcher = hostProcesses.find((item) => item.Name === 'browser-launcher.exe');
    const node = hostProcesses.find((item) => item.Name === 'node.exe');
    assert.ok(launcher && node);
    assert.equal(node.ParentProcessId, launcher.ProcessId);
  }

  /**
   * Yields one finite model decision and receives its actual MCP result from the next provider request.
   */
  async function* steps() {
    if (lifecycle) {
      yield* lifecycle.steps({ url: 'http://octopus-browser.test:' + site.address().port, target });
      completed = true;
      return;
    }
    const status = yield { tool: 'runtime_status', args: {} };
    assert.equal(status.browser.available, true);
    assert.equal(status.computer.available, false);
    const list = yield { tool: 'browser_list', args: {} };
    const connected = list.connections.filter((value) => value.state === 'connected');
    assert.equal(connected.length, 1);
    assert.equal(connected[0].browser, browserName);
    const connectionId = connected[0].connectionId;
    const task = yield {
      tool: 'task_start',
      args: {
        capabilities: ['browser'],
        connectionId,
        idempotencyKey: 'web-browser-task',
      },
    };
    const common = { taskId: task.taskId };
    yield { tool: 'browser_tabs', args: { connectionId } };
    const url = 'http://octopus-browser.test:' + site.address().port;
    const opened = yield { tool: 'browser_open_tab', args: { ...common, url, idempotencyKey: 'web-open' } };
    await expect.poll(() => context.pages().some((page) => page.url() === url + '/')).toBe(true);
    fixturePage = context.pages().find((page) => page.url() === url + '/');
    await fixturePage.waitForLoadState('load');
    const snapshot = yield { tool: 'browser_snapshot', args: { ...common, tabId: opened.tabId } };
    assert.equal(snapshot.text.includes('private-secret-password'), false);
    assert.equal(snapshot.text.includes('private-sensitive-content'), false);
    const click = { ...common, tabId: opened.tabId, target: target(snapshot, 'Fixture click') };
    yield { tool: 'browser_click', args: { ...click, idempotencyKey: 'web-click' } };
    await expect.poll(() => clicks).toBe(1);
    const retained = yield { tool: 'browser_click', args: { ...click, idempotencyKey: 'web-click' } };
    assert.equal(retained.retained, true);
    assert.equal(clicks, 1);
    yield {
      tool: 'browser_click',
      args: { ...click, idempotencyKey: 'web-stale' },
      expectedError: 'SNAPSHOT_EXPIRED',
    };
    const fill = yield { tool: 'browser_snapshot', args: { ...common, tabId: opened.tabId } };
    yield {
      tool: 'browser_fill',
      args: {
        ...common,
        tabId: opened.tabId,
        target: target(fill, 'Fixture input'),
        text: 'literal 中文{Enter}',
        idempotencyKey: 'web-fill',
      },
    };
    assert.equal(
      await fixturePage.getByRole('textbox', { name: 'Fixture input' }).inputValue(),
      'literal 中文{Enter}'
    );
    const select = yield { tool: 'browser_snapshot', args: { ...common, tabId: opened.tabId } };
    yield {
      tool: 'browser_select',
      args: {
        ...common,
        tabId: opened.tabId,
        target: target(select, 'Fixture select'),
        optionText: 'Two',
        idempotencyKey: 'web-select',
      },
    };
    assert.equal(await fixturePage.getByRole('combobox').inputValue(), 'Two');
    const scroll = yield { tool: 'browser_snapshot', args: { ...common, tabId: opened.tabId } };
    const { documentId, controllerId, snapshotId } = scroll;
    yield {
      tool: 'browser_scroll',
      args: {
        ...common,
        tabId: opened.tabId,
        target: { documentId, controllerId, snapshotId },
        direction: 'down',
        pixels: 150,
        idempotencyKey: 'web-scroll',
      },
    };
    assert.ok(await fixturePage.evaluate(() => globalThis.scrollY > 0));
    const beforeNavigation = yield { tool: 'browser_snapshot', args: { ...common, tabId: opened.tabId } };
    // Fixture control simulates an external document replacement, not a product action.
    await fixturePage.goto(url + '/external-navigation');
    yield {
      tool: 'browser_scroll',
      args: {
        ...common,
        tabId: opened.tabId,
        target: {
          documentId: beforeNavigation.documentId,
          controllerId: beforeNavigation.controllerId,
          snapshotId: beforeNavigation.snapshotId,
        },
        direction: 'down',
        pixels: 150,
        idempotencyKey: 'web-old-document',
      },
      expectedError: 'TARGET_CHANGED',
    };
    assert.equal(clicks, 1);
    assert.equal(await fixturePage.evaluate(() => globalThis.scrollY), 0);
    yield {
      tool: 'browser_navigate',
      args: { ...common, tabId: opened.tabId, url: url + '/big', idempotencyKey: 'web-navigate' },
    };
    await fixturePage.waitForURL(url + '/big');
    await fixturePage.waitForLoadState('load');
    const large = yield { tool: 'browser_snapshot', args: { ...common, tabId: opened.tabId } };
    assert.equal(large.hasMore, true);
    let full = large.text;
    let cursor = large.nextCursor;
    pagesRead = 1;
    while (cursor) {
      const next = yield { tool: 'browser_read_snapshot', args: { ...common, cursor } };
      assert.ok(Buffer.byteLength(next.text) <= 65536);
      assert.equal(next.snapshotId, large.snapshotId);
      full += next.text;
      cursor = next.nextCursor;
      pagesRead++;
    }
    assert.equal(pagesRead, large.pages);
    assert.equal(Buffer.byteLength(full), large.totalBytes);
    assert.equal(createHash('sha256').update(full).digest('hex'), large.digest);
    assert.equal(full.includes('private-secret-password'), false);
    assert.equal(full.includes('private-sensitive-content'), false);
    if (dom) {
      yield* dom.steps({ task, tabId: opened.tabId, page: fixturePage, target, url });
      completed = true;
      return;
    }
    if (inflight) {
      const current = yield { tool: 'browser_snapshot', args: { ...common, tabId: opened.tabId } };
      yield* inflight.steps({
        task,
        connection: connectionId,
        tabId: opened.tabId,
        snapshot: current,
        target,
      });
      completed = true;
      return;
    }
    if (check === 'recovery') {
      recovery = createWebBrowserRecovery({
        context,
        expect,
        extensionId,
        browserName,
        readHostProcesses,
        clicks: () => clicks,
      });
      const current = yield { tool: 'browser_snapshot', args: { ...common, tabId: opened.tabId } };
      yield* recovery.steps({
        task,
        connection: connectionId,
        tabId: opened.tabId,
        page: fixturePage,
        snapshot: current,
        target,
        url,
      });
      hostProcesses = await readHostProcesses();
      completed = true;
      return;
    }
    const closed = yield {
      tool: 'browser_close_tab',
      args: { ...common, tabId: opened.tabId, idempotencyKey: 'web-close' },
    };
    assert.equal(closed.code, 'TAB_CLOSED');
    const tabs = yield { tool: 'browser_tabs', args: { connectionId } };
    assert.equal(
      tabs.tabs.some((tab) => tab.tabId === opened.tabId),
      false
    );
    yield { tool: 'task_end', args: common };
    completed = true;
  }

  /**
   * Verifies Runtime shutdown reaches the real extension and does not replay the accepted click.
   */
  async function verifyExit() {
    if (lifecycle)
      await expect
        .poll(async () => (await lifecycle.storage()).bridgeStatus, { timeout: 15000 })
        .not.toBe('connected');
    else {
      worker = context.serviceWorkers().find((item) => item.url().includes(extensionId));
      await expect
        .poll(
          () =>
            worker.evaluate(
              async () => (await globalThis.chrome.storage.local.get('bridgeStatus')).bridgeStatus
            ),
          { timeout: 15000 }
        )
        .not.toBe('connected');
    }
    await expect
      .poll(
        async () => {
          const running = await readHostProcesses();
          return running.filter((item) =>
            hostProcesses.some((previous) => previous.ProcessId === item.ProcessId)
          ).length;
        },
        { timeout: 10000 }
      )
      .toBe(0);
    let expectedClicks = 1;
    if (check === 'recovery' || inflight) expectedClicks = 2;
    else if (dom) expectedClicks = 3;
    else if (lifecycle) expectedClicks = lifecycle.evidence().records.length;
    assert.equal(clicks, expectedClicks);
    assert.ok(completed || inflight?.cancelled());
    return {
      browser: browserName,
      version,
      browserTools: lifecycle ? 5 : 11,
      pagesRead,
      clicks,
      ...(lifecycle
        ? { oldReferenceRejected: true }
        : { staleSnapshotRejected: true, oldDocumentRejected: true }),
      ...(recovery ? { recovery: recovery.evidence() } : {}),
      ...(inflight ? { inflight: inflight.evidence() } : {}),
      ...(dom ? { dom: dom.evidence() } : {}),
      ...(lifecycle ? { lifecycle: lifecycle.evidence() } : {}),
      hostProcesses,
      originalHostExited: true,
    };
  }

  /**
   * Releases only fixture-owned browser, server and registration resources.
   */
  async function close() {
    inflight?.close();
    try {
      await lifecycle?.close();
      await context?.close();
    } finally {
      site.closeAllConnections();
      if (site.listening) await new Promise((resolve) => site.close(resolve));
      if (registered) await register('remove');
    }
  }
  return {
    start,
    steps,
    verifyExit,
    close,
    observe: (...args) => inflight?.observe(...args),
    cancelled: () => inflight?.cancelled() ?? false,
    verifyInflight: () => inflight?.verify(),
  };
}
