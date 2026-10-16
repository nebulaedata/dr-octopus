/**
 * @author Codex
 * @description Assembles one Basic tool authority with private PowerShell and drains its tasks before Utility shutdown.
 */
import { computerStopMessageSchema } from '../contracts/computer-use';
import { deviceIdentitySchema } from '../contracts/device-identity';
import { hostRequestSchema, type AccessSnapshot } from '../contracts/access';
import { ComputerUseActivity } from './computer/computer-use-activity';
import { ComputerRuntime } from './computer/computer-runtime';
import { ComputerBackend } from './computer/computer-backend';
import { ComputerIndicatorConfirmation } from './computer/computer-indicator-confirmation';
import { ControlStore } from './mcp/control-store';
import { TaskAuthority } from './mcp/task-authority';
import { HttpGateway } from './mcp/http-gateway';
import { runtimeMessageSchema } from '../contracts/runtime';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, dirname, join } from 'node:path';
import { ShellExecutor } from './basic/shell-executor';
import { NodeResources } from './basic/node-resources';

import { BasicTools } from './basic/basic-tools';
import { NativeFileCommit } from './basic/native-file-commit';
import { FilePublication } from './basic/file-publication';
import { SearchTools } from './basic/search-tools';
import { BrowserTools } from './browser/browser-tools';
import { BrowserBridge } from './browser/browser-bridge';
import { BridgeStore } from './browser/bridge-store';
import { networkAddressSchema } from '../contracts/connection-settings';
import { TransferFiles } from './transfer/transfer-files';
import { TransferStore } from './transfer/transfer-store';
import { TransferService } from './transfer/transfer-service';
import { transferSettingsSchema, defaultTransferSettings } from '../contracts/transfer-settings';
import { createRuntimeTemporary } from './basic/runtime-temporary';
import { protectExecutorStorage } from './basic/file-policy';
import { executorToolCatalog } from './mcp/mcp-server';

declare const NODE_RESOURCE_HASH: string;

const port = process.parentPort;
if (!port) {
  throw new Error('Executor Runtime requires a Utility Process parent port.');
}

// Keep ownership explicit rather than relying on incidental event-loop handles.
const confirmation = new ComputerIndicatorConfirmation();
const computerUse = new ComputerUseActivity(
  (activity) => {
    port.postMessage({ type: 'computer-use', pid: process.pid, activity });
  },
  (revision) => confirmation.wait(revision)
);
const keepAlive = setInterval(() => {}, 60_000);
const userData = process.argv[2];
const nativePath = process.argv[3];
if (!userData || !nativePath || !isAbsolute(userData) || !isAbsolute(nativePath)) {
  throw new Error('Runtime requires Host-owned absolute data and resource paths.');
}
// Start the fixed local backend independently; ComputerTools still require handshake and explicit grants.
const computerRuntime = new ComputerRuntime(
  computerUse,
  new ComputerBackend(join(dirname(nativePath), '..'))
);
const computer = computerRuntime.tools;
void computerRuntime.start();
const selectedPort = Number(process.argv[4]);
if (!Number.isInteger(selectedPort) || selectedPort < 0 || selectedPort > 65535) {
  throw new Error('Runtime requires a trusted TCP port.');
}
let stopping: Promise<void> | null = null;
let computerStopping: Promise<void> | null = null;
const networkAddress = process.argv[5] ? networkAddressSchema.parse(process.argv[5]) : null;
const device = deviceIdentitySchema.parse(JSON.parse(process.argv[6] ?? 'null'));
const transferSettings = transferSettingsSchema.parse(
  process.argv[7] ? JSON.parse(process.argv[7]) : defaultTransferSettings
);
const projectRoot = process.argv[8] ?? join(userData, 'project');
if (!isAbsolute(projectRoot)) {
  throw new Error('Runtime requires an absolute project directory.');
}
let hostRequests = 0;
const initialized = (async () => {
  await mkdir(userData, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  const native = new NativeFileCommit(nativePath);
  protectExecutorStorage(projectRoot);
  const publication = await FilePublication.open(native, projectRoot);
  let temporary: Awaited<ReturnType<typeof createRuntimeTemporary>> | undefined;
  let shell: ShellExecutor | undefined;
  let tools: BasicTools | undefined;
  let authority: TaskAuthority | undefined;
  let gateway: HttpGateway | undefined;
  let store: ControlStore | undefined;
  let browser: BrowserBridge | undefined;
  try {
    temporary = await createRuntimeTemporary(native);
    protectExecutorStorage(temporary.root);
    const node = await NodeResources.open(
      join(dirname(nativePath), '..'),
      native,
      typeof NODE_RESOURCE_HASH === 'undefined' ? '' : NODE_RESOURCE_HASH
    );
    shell = await ShellExecutor.open(
      join(dirname(nativePath), 'process-supervisor.exe'),
      projectRoot,
      native,
      node
    );
    const search = new SearchTools(
      join(dirname(nativePath), 'process-supervisor.exe'),
      join(dirname(nativePath), '..', 'resources', 'search'),
      temporary.root,
      native
    );
    await search.verify();
    tools = new BasicTools(publication, shell, search);
    store = await ControlStore.open(native, projectRoot);
    browser = new BrowserBridge(await BridgeStore.open(native, projectRoot));
    authority = new TaskAuthority(tools, store, computer, new BrowserTools(browser), device);
    const transferStore = await TransferStore.open(native, projectRoot);
    const transferAuthority = authority;
    await authority.attachTransfers(
      new TransferService(
        transferStore,
        new TransferFiles(native, transferStore.materialRoot, transferSettings),
        (...args) => transferAuthority.transferContext(...args),
        transferSettings
      )
    );
    gateway = new HttpGateway(authority, browser);
    const endpoint = await gateway.listen(selectedPort, networkAddress);
    await browser.initialize(endpoint);
    return { tools, authority, gateway, endpoint, browser, computerUse, temporary };
  } catch (error) {
    browser?.close();
    await Promise.allSettled([gateway?.close(), authority?.close(), store?.close()]);
    await Promise.allSettled([computerRuntime.close(), tools?.close(), publication.close(), shell?.close()]);
    await temporary?.close();
    throw error;
  }
})();
port.on('message', (event: { data: unknown }) => {
  if (confirmation.receive(event.data)) {
    return;
  }
  const localStop = computerStopMessageSchema.safeParse(event.data);
  if (localStop.success) {
    const activity = computerUse.snapshot();
    if (
      !stopping &&
      !computerStopping &&
      activity.state !== 'idle' &&
      activity.activityId === localStop.data.activityId
    ) {
      computerStopping = initialized
        .then(async (runtime) => {
          if (computerUse.snapshot().activityId !== localStop.data.activityId) {
            return;
          }
          confirmation.close();
          const taskDrain = runtime.authority.stopComputerUse();
          const results = await Promise.allSettled([computerRuntime.close(), taskDrain]);
          if (results.some((result) => result.status === 'rejected')) {
            console.error('[executor] Local desktop stop was not fully confirmed.');
          }
        })
        .catch(() => {
          console.error('[executor] Local desktop stop could not reach the owned Runtime.');
        })
        .finally(() => {
          computerStopping = null;
        });
    }
    return;
  }
  const request = hostRequestSchema.safeParse(event.data);
  if (request.success) {
    const input = request.data;
    if (stopping || hostRequests >= 8) {
      port.postMessage({
        type: 'access-reply',
        requestId: input.requestId,
        computer: computerRuntime.status(),
        response: { ok: false, code: 'UNAVAILABLE', message: '执行服务暂不可接受请求' },
      });
      return;
    }
    hostRequests++;
    void initialized
      .then(async (runtime) => {
        if (stopping) {
          throw new Error('Runtime stopping.');
        }
        let credential: string | undefined;
        let clientId: string | undefined;
        if (input.type === 'access-approve') {
          const approved = await runtime.authority.approve(input.input);
          credential = approved.token;
          clientId = approved.grant.clientId;
        } else if (input.type === 'access-revoke') {
          await runtime.authority.revoke(input.clientId);
          await runtime.gateway.revoke(input.clientId);
        } else if (input.type === 'browser-enable') {
          await runtime.browser.setEnabled(input.enabled);
        }
        const data: AccessSnapshot = {
          toolCatalog: executorToolCatalog(
            !!runtime.authority.transfers,
            runtime.tools.shellStatus().available
          ),
          device,
          endpoint: runtime.gateway.isListening() ? runtime.endpoint : null,
          remoteEndpoint: runtime.gateway.remoteEndpoint(),
          clients: runtime.authority.clients(),
          connections: runtime.gateway.connections(),
          browser: runtime.browser.snapshot(),
        };
        port.postMessage({
          type: 'access-reply',
          requestId: input.requestId,
          computer: computerRuntime.status(),
          response: { ok: true, data },
          ...(credential ? { credential, clientId } : {}),
        });
      })
      .catch(() => {
        port.postMessage({
          type: 'access-reply',
          requestId: input.requestId,
          computer: computerRuntime.status(),
          response: { ok: false, code: 'ACCESS_FAILED', message: '授权操作失败，请刷新连接状态后重试' },
        });
      })
      .finally(() => {
        hostRequests--;
      });
    return;
  }
  const result = runtimeMessageSchema.safeParse(event.data);
  if (result.success && result.data.type === 'shutdown') {
    if (!stopping) {
      confirmation.close();
      stopping = initialized.then(async (runtime) => {
        try {
          await runtime.gateway.close();
        } finally {
          await Promise.all([computerRuntime.close(), runtime.tools.close()]);
          await runtime.temporary.close();
        }
      });
      stopping.then(
        () => {
          clearInterval(keepAlive);
          process.exit(0);
        },
        () => {
          clearInterval(keepAlive);
          process.exit(1);
        }
      );
    }
  }
});
initialized.then(
  (runtime) => {
    if (!stopping) {
      port.postMessage({
        type: 'ready',
        pid: process.pid,
        startedAt: new Date().toISOString(),
        endpoint: runtime.endpoint,
        computer: computerRuntime.status(),
      });
    }
  },
  () => {
    clearInterval(keepAlive);
    console.error('[executor] Basic Runtime initialization failed.');
    process.exit(1);
  }
);
