/**
 * @author Codex
 * @description Registers named status IPC with registered-window, main-frame, origin and input validation.
 */
import { app, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toolPolicySettingsSchema, type ToolPoliciesResponse } from '../contracts/tool-policy';
import { executionResourceRoot } from './resource-paths';
import { configureBrowserHost, browserExtensionFolder } from './browser-installation';
import { settingsInputSchema } from '../contracts/connection-settings';
import { listNetworkAddresses } from './network-addresses';
import type { NetworkAddressesResponse, SettingsResponse } from '../contracts/connection-settings';
import { approvalInputSchema, revokeInputSchema } from '../contracts/access';
import type { AccessResponse } from '../contracts/access';
import { NativeFileCommit } from '../runtime/basic/native-file-commit';
import { ClientConfigurations } from './client-configurations';
import { clientConfigurationInputSchema } from '../contracts/client-configuration';
import type {
  ClientConfigurationResponse,
  ClientConfigurationActionResponse,
} from '../contracts/client-configuration';
import { emptyRequestSchema, browserSelectionSchema, ipcChannels } from '../contracts/runtime';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { RuntimeManager } from './runtime-manager';
import type { StatusResponse, DesktopActionResponse } from '../contracts/runtime';
import type { BrowserDiagnosticsResponse } from '../contracts/runtime';
import { maintenanceActionSchema } from '../contracts/maintenance';
import type { MaintenanceResponse } from '../contracts/maintenance';
import type { RuntimeRecovery } from '../maintenance/runtime-recovery';

/**
 * Checks the actual sender frame and rejects auxiliary windows or opaque origins.
 */
export function isTrustedSender(
  event: IpcMainInvokeEvent,
  windows: Set<BrowserWindow>,
  origin: string
): boolean {
  const owner = [...windows].find((window) => !window.isDestroyed() && window.webContents === event.sender);
  return Boolean(
    owner &&
    event.senderFrame &&
    event.senderFrame === owner.webContents.mainFrame &&
    event.senderFrame.origin === origin
  );
}

/**
 * Installs handlers once and returns teardown for handlers and Runtime subscription.
 */
export function registerDesktopIpc(
  manager: RuntimeManager,
  windows: Set<BrowserWindow>,
  origin: string,
  automaticBrowserSetup = false,
  restartApplication?: () => boolean,
  recovery?: RuntimeRecovery
): () => void {
  const resourceRoot = executionResourceRoot(app.isPackaged, process.resourcesPath, app.getAppPath());
  const native = new NativeFileCommit(join(resourceRoot, 'native/file-commit.node'));
  const configurations = new ClientConfigurations(native, manager.projectRoot, resourceRoot);
  let restarting = false;
  let changing = false;
  let configuringBrowser = false;
  let configuredEpoch = '';
  const browserSetupLifetime = new AbortController();
  ipcMain.handle(
    ipcChannels.readToolPolicies,
    async (event, input: unknown): Promise<ToolPoliciesResponse> => {
      if (!isTrustedSender(event, windows, origin) || !emptyRequestSchema.safeParse(input).success) {
        return { ok: false, message: '此页面无法读取工具策略' };
      }
      return manager.readToolPolicies();
    }
  );
  ipcMain.handle(
    ipcChannels.saveToolPolicies,
    async (event, input: unknown): Promise<ToolPoliciesResponse> => {
      const parsed = toolPolicySettingsSchema.safeParse(input);
      if (!isTrustedSender(event, windows, origin) || !parsed.success || restarting || recovery?.isBusy()) {
        return { ok: false, message: '此页面无法修改工具策略，或请求参数无效' };
      }
      return manager.saveToolPolicies(parsed.data);
    }
  );
  ipcMain.handle(ipcChannels.readMaintenance, (event, input: unknown): MaintenanceResponse => {
    if (
      !isTrustedSender(event, windows, origin) ||
      !emptyRequestSchema.safeParse(input).success ||
      !recovery
    ) {
      return { ok: false, message: '此页面无法读取恢复状态' };
    }
    return { ok: true, data: recovery.read() };
  });
  ipcMain.handle(
    ipcChannels.maintenanceAction,
    async (event, input: unknown): Promise<DesktopActionResponse> => {
      const parsed = maintenanceActionSchema.safeParse(input);
      if (!isTrustedSender(event, windows, origin) || !parsed.success || !recovery || restarting) {
        return { ok: false, message: '此页面无法执行恢复操作' };
      }
      const { action, revision } = parsed.data;
      try {
        if (action === 'reset' || action === 'retry') {
          if (changing || manager.isSavingSettings()) {
            return { ok: false, message: '请等待当前保存或授权操作完成' };
          }
          await recovery.run(action, revision);
        } else if (action === 'dismiss') {
          recovery.dismiss();
        } else if (action === 'copy-details') {
          const state = recovery.read();
          clipboard.writeText(
            JSON.stringify({ issue: state.issue, phase: state.phase, message: state.message }, null, 2)
          );
        } else {
          const backup = recovery.read().backupPath;
          if (!backup || recovery.isBusy()) {
            return { ok: false, message: '备份尚不可用' };
          }
          const info = await native.inspect(backup);
          if (!info.ok || !info.directory || !info.privateAcl || !isTrustedSender(event, windows, origin)) {
            return { ok: false, message: '无法打开备份目录' };
          }
          if (await shell.openPath(backup)) {
            return { ok: false, message: '无法打开备份目录' };
          }
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message.slice(0, 200) : '恢复操作失败，请刷新后重试',
        };
      }
    }
  );
  ipcMain.handle(
    ipcChannels.restartApplication,
    async (event, input: unknown): Promise<DesktopActionResponse> => {
      if (!isTrustedSender(event, windows, origin) || !emptyRequestSchema.safeParse(input).success) {
        return { ok: false, message: '此页面无法重启执行器' };
      }
      const settings = await manager.readSettings();
      if (
        !isTrustedSender(event, windows, origin) ||
        restarting ||
        recovery?.isBusy() ||
        manager.isSavingSettings() ||
        !settings.ok ||
        !settings.data.pendingRestart
      ) {
        return { ok: false, message: '请先保存需要重启的设置，或等待当前保存完成' };
      }
      if (!restartApplication?.()) {
        return { ok: false, message: '执行器暂不可重启，请完整退出后重新打开' };
      }
      restarting = true;
      return { ok: true };
    }
  );
  ipcMain.handle(
    ipcChannels.configureBrowserHost,
    async (event, input: unknown): Promise<DesktopActionResponse> => {
      if (!isTrustedSender(event, windows, origin) || !emptyRequestSchema.safeParse(input).success) {
        return { ok: false, message: '此页面无法配置浏览器连接' };
      }
      if (configuringBrowser) {
        return { ok: false, message: '正在配置浏览器连接，请稍候' };
      }
      configuringBrowser = true;
      try {
        await configureBrowserHost(resourceRoot, manager.projectRoot, browserSetupLifetime.signal);
        return { ok: true };
      } catch {
        return {
          ok: false,
          message:
            '浏览器连接配置失败。请确认安装资源完整、目录可写，且现有 Host 注册属于本产品；修复后可重试。',
        };
      } finally {
        configuringBrowser = false;
      }
    }
  );
  ipcMain.handle(
    ipcChannels.openBrowserExtensionFolder,
    async (event, input: unknown): Promise<DesktopActionResponse> => {
      const selection = browserSelectionSchema.safeParse(input);
      if (!isTrustedSender(event, windows, origin) || !selection.success) {
        return { ok: false, message: '此页面无法打开插件目录' };
      }
      try {
        const root = app.isPackaged
          ? join(process.resourcesPath, 'browser')
          : join(app.getAppPath(), '../browser-extension/.output');
        const browser = selection.data.browser;
        const folder = app.isPackaged
          ? await browserExtensionFolder(root, browser)
          : await browserExtensionFolder(root, browser === 'chrome' ? 'chrome-mv3' : 'edge-mv3');
        if (!isTrustedSender(event, windows, origin)) {
          return { ok: false, message: '窗口已断开' };
        }
        const error = await shell.openPath(folder);
        return error ? { ok: false, message: '无法打开插件目录，请检查安装包或重新安装' } : { ok: true };
      } catch {
        return { ok: false, message: '未找到随包插件，请下载完整安装包或重新安装' };
      }
    }
  );
  ipcMain.handle(
    ipcChannels.browserDiagnostics,
    async (event, input: unknown): Promise<BrowserDiagnosticsResponse> => {
      if (!isTrustedSender(event, windows, origin) || !emptyRequestSchema.safeParse(input).success) {
        return { ok: false, message: '此页面无法读取浏览器诊断' };
      }
      const results = await Promise.allSettled(
        [
          'native/browser-launcher.exe',
          'native/file-commit.node',
          'bridge/native-host.cjs',
          'resources/node/node.exe',
          'resources/node/LICENSE',
        ].map((path) => access(join(resourceRoot, path)))
      );
      if (!isTrustedSender(event, windows, origin)) {
        return { ok: false, message: '窗口已断开' };
      }
      return {
        ok: true,
        data: {
          resourceRoot,
          projectRoot: manager.projectRoot,
          resourcesAvailable: results.every((item) => item.status === 'fulfilled'),
        },
      };
    }
  );
  ipcMain.handle(ipcChannels.setBrowserEnabled, async (event, input: unknown): Promise<AccessResponse> => {
    if (!isTrustedSender(event, windows, origin)) {
      return { ok: false, code: 'FORBIDDEN', message: '此页面无法管理浏览器桥接' };
    }
    const result = z.strictObject({ enabled: z.boolean() }).safeParse(input);
    if (!result.success) {
      return { ok: false, code: 'INVALID_REQUEST', message: '浏览器设置参数无效' };
    }
    try {
      return (await manager.request({ type: 'browser-enable', enabled: result.data.enabled })).response;
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '浏览器桥接设置未获确认，请刷新状态' };
    }
  });
  ipcMain.handle(ipcChannels.copyEndpoint, async (event, input: unknown): Promise<DesktopActionResponse> => {
    if (!isTrustedSender(event, windows, origin) || !emptyRequestSchema.safeParse(input).success) {
      return { ok: false, message: '此页面无法复制连接地址' };
    }
    try {
      const reply = await manager.request({ type: 'access-list' });
      if (!reply.response.ok || !reply.response.data.endpoint || !isTrustedSender(event, windows, origin)) {
        return { ok: false, message: '执行服务未就绪，无法复制地址' };
      }
      clipboard.writeText(reply.response.data.remoteEndpoint ?? reply.response.data.endpoint);
      return { ok: true };
    } catch {
      return { ok: false, message: '连接地址复制失败' };
    }
  });
  ipcMain.handle(ipcChannels.readNetworkAddresses, (event, input: unknown): NetworkAddressesResponse => {
    if (!isTrustedSender(event, windows, origin)) {
      return { ok: false, code: 'FORBIDDEN', message: '此页面无法读取本机网络地址' };
    }
    if (!emptyRequestSchema.safeParse(input).success) {
      return { ok: false, code: 'INVALID_REQUEST', message: '请求参数无效' };
    }
    try {
      return { ok: true, data: listNetworkAddresses() };
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '无法读取本机网络地址，请刷新重试' };
    }
  });
  ipcMain.handle(ipcChannels.readSettings, async (event, input: unknown): Promise<SettingsResponse> => {
    if (!isTrustedSender(event, windows, origin)) {
      return { ok: false, code: 'FORBIDDEN', message: '此页面无法管理连接设置' };
    }
    if (!emptyRequestSchema.safeParse(input).success) {
      return { ok: false, code: 'INVALID_REQUEST', message: '请求参数无效' };
    }
    return manager.readSettings();
  });
  ipcMain.handle(ipcChannels.saveSettings, async (event, input: unknown): Promise<SettingsResponse> => {
    if (!isTrustedSender(event, windows, origin)) {
      return { ok: false, code: 'FORBIDDEN', message: '此页面无法管理连接设置' };
    }
    if (restarting || recovery?.isBusy()) {
      return { ok: false, code: 'UNAVAILABLE', message: '执行器正在重启，暂不可保存设置' };
    }
    const parsed = settingsInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: 'INVALID_REQUEST', message: '连接设置参数无效' };
    }
    if (parsed.data.networkAddress !== null) {
      try {
        if (!listNetworkAddresses().some((item) => item.address === parsed.data.networkAddress)) {
          return {
            ok: false,
            code: 'INVALID_REQUEST',
            message: '所选内网地址当前不在本机，请刷新地址列表后重新选择，或关闭内网访问',
          };
        }
      } catch {
        return { ok: false, code: 'UNAVAILABLE', message: '无法确认本机网络地址，请刷新重试' };
      }
    }
    const reply = await manager.saveSettings(parsed.data);
    if (reply.ok) {
      nativeTheme.themeSource = reply.data.themeSource;
    }
    return reply;
  });
  ipcMain.handle(ipcChannels.readAccess, async (event, input: unknown): Promise<AccessResponse> => {
    if (!isTrustedSender(event, windows, origin)) {
      return { ok: false, code: 'FORBIDDEN', message: '此页面无法管理连接' };
    }
    if (!emptyRequestSchema.safeParse(input).success) {
      return { ok: false, code: 'INVALID_REQUEST', message: '请求参数无效' };
    }
    try {
      return (await manager.request({ type: 'access-list' })).response;
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '执行服务不可用' };
    }
  });
  ipcMain.handle(ipcChannels.approveAccess, async (event, input: unknown): Promise<AccessResponse> => {
    if (!isTrustedSender(event, windows, origin)) {
      return { ok: false, code: 'FORBIDDEN', message: '此页面无法管理连接' };
    }
    const parsed = approvalInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: 'INVALID_REQUEST', message: '授权参数无效' };
    }
    if (changing || manager.readStatus().state !== 'ready') {
      return { ok: false, code: 'UNAVAILABLE', message: '请等待当前操作完成或执行服务就绪' };
    }
    changing = true;
    let clientId: string | undefined;
    try {
      const reply = await manager.request({
        type: 'access-approve',
        input: parsed.data,
      });
      if (!reply.response.ok || !reply.credential || !reply.clientId) {
        return reply.response.ok
          ? { ok: false, code: 'ACCESS_FAILED', message: '授权未获确认' }
          : reply.response;
      }
      clientId = reply.clientId;
      await configurations.store(clientId, reply.credential);
      return reply.response;
    } catch (error) {
      if (clientId) {
        try {
          const revoked = await manager.request({ type: 'access-revoke', clientId });
          if (!revoked.response.ok) {
            throw new Error('Revocation unconfirmed.', { cause: error });
          }
        } catch {
          return {
            ok: false,
            code: 'REVOCATION_UNCONFIRMED',
            message: '凭据保存失败且撤销未获确认，请刷新并撤销该授权',
          };
        }
      }
      return {
        ok: false,
        code: 'ACCESS_FAILED',
        message: '授权凭据保存失败，请刷新并确认授权状态',
      };
    } finally {
      changing = false;
    }
  });
  const configurationActions = {
    read: ipcChannels.readClientConfiguration,
    copy: ipcChannels.copyClientConfiguration,
    guide: ipcChannels.copyAgentGuide,
    download: ipcChannels.downloadClientConfiguration,
  } as const;
  for (const [action, channel] of Object.entries(configurationActions)) {
    ipcMain.handle(
      channel,
      async (
        event,
        input: unknown
      ): Promise<ClientConfigurationResponse | ClientConfigurationActionResponse> => {
        const parsed = clientConfigurationInputSchema.safeParse(input);
        if (!isTrustedSender(event, windows, origin) || !parsed.success) {
          return { ok: false, message: '此页面无法配置客户端' };
        }
        if (changing) {
          return { ok: false, message: '请等待当前操作完成' };
        }
        changing = true;
        try {
          const initial = await manager.request({ type: 'access-list' });
          if (!initial.response.ok) {
            return { ok: false, message: '执行服务未就绪' };
          }
          let output: string | undefined;
          if (action === 'download') {
            const owner = [...windows].find((window) => window.webContents === event.sender)!;
            const selection = await dialog.showSaveDialog(owner, {
              title: '下载 MCP 客户端配置',
              defaultPath: `octopus-connection-${randomUUID()}.json`,
              filters: [{ name: 'JSON', extensions: ['json'] }],
            });
            if (selection.canceled || !selection.filePath) {
              return { ok: true, cancelled: true };
            }
            output = selection.filePath;
          }
          const live = await manager.request({ type: 'access-list' });
          if (!live.response.ok || !isTrustedSender(event, windows, origin)) {
            return { ok: false, message: '窗口或执行服务已断开' };
          }
          const config =
            action === 'guide'
              ? await configurations.agentGuide(parsed.data, live.response.data)
              : await configurations.configuration(parsed.data, live.response.data, action === 'read');
          if (!isTrustedSender(event, windows, origin)) {
            return { ok: false, message: '窗口已断开' };
          }
          if (action === 'read') {
            return { ok: true, data: { preview: config } };
          }
          if (action === 'copy' || action === 'guide') {
            clipboard.writeText(config);
            return { ok: true, cancelled: false };
          }
          const written = await native.writePrivateConfig(output!, config);
          if (!written.ok || !written.privateAcl) {
            return { ok: false, message: '配置未下载，目标文件可能已存在；请选择新文件。授权仍然保留。' };
          }
          return { ok: true, cancelled: false };
        } catch {
          return {
            ok: false,
            message: '无法读取此授权的客户端配置。请确认服务与连接方式可用；凭据缺失时需重新创建授权。',
          };
        } finally {
          changing = false;
        }
      }
    );
  }
  ipcMain.handle(ipcChannels.revokeAccess, async (event, input: unknown): Promise<AccessResponse> => {
    if (!isTrustedSender(event, windows, origin)) {
      return { ok: false, code: 'FORBIDDEN', message: '此页面无法管理连接' };
    }
    const parsed = revokeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: 'INVALID_REQUEST', message: '撤销参数无效' };
    }
    if (changing) {
      return { ok: false, code: 'UNAVAILABLE', message: '请等待当前操作完成' };
    }
    changing = true;
    try {
      return (await manager.request({ type: 'access-revoke', clientId: parsed.data.clientId })).response;
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '撤销未获确认，请刷新连接状态' };
    } finally {
      changing = false;
    }
  });
  ipcMain.handle(ipcChannels.readStatus, (event, input: unknown): StatusResponse => {
    if (!isTrustedSender(event, windows, origin)) {
      return { ok: false, code: 'FORBIDDEN', message: '此页面无法访问执行服务' };
    }
    if (!emptyRequestSchema.safeParse(input).success) {
      return { ok: false, code: 'INVALID_REQUEST', message: '请求参数无效' };
    }
    return { ok: true, data: manager.readStatus() };
  });
  const unsubscribe = manager.subscribe((snapshot) => {
    const epoch = `${snapshot.pid}:${snapshot.startedAt}`;
    if (
      automaticBrowserSetup &&
      snapshot.state === 'ready' &&
      epoch !== configuredEpoch &&
      !configuringBrowser
    ) {
      configuredEpoch = epoch;
      configuringBrowser = true;
      void configureBrowserHost(resourceRoot, manager.projectRoot, browserSetupLifetime.signal)
        .catch(() => {
          console.error('[executor] Automatic Browser Host setup failed; retry from Connections.');
        })
        .finally(() => {
          configuringBrowser = false;
        });
    }
    for (const window of windows) {
      if (
        !window.isDestroyed() &&
        !window.webContents.isDestroyed() &&
        window.webContents.mainFrame.origin === origin
      ) {
        window.webContents.send(ipcChannels.statusChanged, snapshot);
      }
    }
  });
  return () => {
    browserSetupLifetime.abort();
    unsubscribe();
    ipcMain.removeHandler(ipcChannels.restartApplication);
    ipcMain.removeHandler(ipcChannels.readToolPolicies);
    ipcMain.removeHandler(ipcChannels.saveToolPolicies);
    ipcMain.removeHandler(ipcChannels.readMaintenance);
    ipcMain.removeHandler(ipcChannels.maintenanceAction);
    ipcMain.removeHandler(ipcChannels.readNetworkAddresses);
    ipcMain.removeHandler(ipcChannels.readSettings);
    ipcMain.removeHandler(ipcChannels.setBrowserEnabled);
    ipcMain.removeHandler(ipcChannels.browserDiagnostics);
    ipcMain.removeHandler(ipcChannels.configureBrowserHost);
    ipcMain.removeHandler(ipcChannels.openBrowserExtensionFolder);
    ipcMain.removeHandler(ipcChannels.copyEndpoint);
    ipcMain.removeHandler(ipcChannels.saveSettings);
    ipcMain.removeHandler(ipcChannels.readStatus);
    ipcMain.removeHandler(ipcChannels.readAccess);
    for (const channel of Object.values(configurationActions)) {
      ipcMain.removeHandler(channel);
    }
    ipcMain.removeHandler(ipcChannels.approveAccess);
    ipcMain.removeHandler(ipcChannels.revokeAccess);
  };
}
