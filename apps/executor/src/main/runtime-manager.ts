/**
 * @author Codex
 * @description Owns one Utility Runtime, bounded startup/shutdown and authoritative lifecycle snapshots.
 */
import { computerUseMessageSchema } from '../contracts/computer-use';
import { ConnectionSettings } from './connection-settings';
import { DeviceIdentityStore } from './device-identity';
import type { DeviceIdentity } from '../contracts/device-identity';
import { NativeFileCommit } from '../runtime/basic/native-file-commit';
import type { SettingsResponse, SettingsInput } from '../contracts/connection-settings';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { defaultTransferSettings, type TransferSettings } from '../contracts/transfer-settings';
import { hostReplySchema, hostRequestSchema } from '../contracts/access';
import type { z } from 'zod';
import { utilityProcess } from 'electron';
import { runtimeMessageSchema } from '../contracts/runtime';
import type { RuntimeSnapshot } from '../contracts/runtime';
import type { UtilityProcess } from 'electron';

type HostRequest = z.infer<typeof hostRequestSchema>;
type HostCommand<T = HostRequest> = T extends HostRequest ? Omit<T, 'requestId'> : never;

export class RuntimeManager {
  /**
   * Stops only the activity observed by trusted Main, never a new task that began after Escape was queued.
   * @returns Whether the current owned Runtime accepted the stop message for delivery.
   */
  stopComputerUse(activityId: string, pid: number | null): boolean {
    if (
      !this.child ||
      this.snapshot.state !== 'ready' ||
      this.snapshot.pid !== pid ||
      this.snapshot.computerUse.state === 'idle' ||
      this.snapshot.computerUse.activityId !== activityId
    ) {
      return false;
    }
    try {
      this.child.postMessage({ type: 'computer-stop', activityId });
      return true;
    } catch {
      return false;
    }
  }
  private readonly requests = new Map<
    string,
    {
      resolve: (reply: z.infer<typeof hostReplySchema>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private settings: Promise<ConnectionSettings> | null = null;
  private identity: DeviceIdentityStore | null = null;
  private activeDevice: DeviceIdentity | null = null;
  private activeTransfer: TransferSettings = { ...defaultTransferSettings };
  private savingSettings = false;
  private networkAddress: string | null = null;
  private child: UtilityProcess | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private listeners = new Set<(snapshot: RuntimeSnapshot) => void>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private checkingHealth = false;
  private snapshot: RuntimeSnapshot = {
    state: 'stopped',
    revision: 0,
    pid: null,
    startedAt: null,
    message: '执行服务尚未启动',
    startupFailure: null,
    listenFailure: null,
    computerUse: { revision: 0, activityId: null, state: 'idle', activeCalls: 0, activeTasks: 0 },
    health: { state: 'unknown', checkedAt: null },
    capabilities: {
      basic: { available: false, reason: '基础后端待初始化，MCP 尚未接入' },
      browser: { available: false, reason: '尚无已验证的浏览器工具连接' },
      computer: { state: 'stopped', available: false, reason: '桌面后端尚未启动' },
    },
  };

  /**
   * Binds this manager to an application-owned build artifact.
   */
  constructor(
    private readonly entry: string,
    private readonly userData: string,
    private readonly nativePath: string,
    private port = 19876,
    readonly projectRoot = join(userData, 'project')
  ) {}

  /**
   * Returns a detached snapshot so consumers cannot mutate manager state.
   */
  readStatus(): RuntimeSnapshot {
    return structuredClone(this.snapshot);
  }

  /**
   * Loads one Main-owned settings journal and reuses its validated snapshot.
   */
  private loadSettings(): Promise<ConnectionSettings> {
    this.settings ??= (async () => {
      const native = new NativeFileCommit(this.nativePath);
      const settings = await ConnectionSettings.open(native, this.projectRoot);
      this.identity = await DeviceIdentityStore.open(native, this.projectRoot, settings.hasIdentity());
      if (!settings.hasIdentity()) {
        const values = settings.read();
        await settings.save(
          {
            port: values.port,
            networkAddress: values.networkAddress,
            closeBehavior: values.closeBehavior,
            themeSource: values.themeSource,
            transfer: values.transfer,
          },
          true
        );
      }
      return settings;
    })();
    return this.settings;
  }

  /**
   * Reports saved UI and next-start listener settings without changing the current Runtime or its tasks.
   */
  async readSettings(): Promise<SettingsResponse> {
    try {
      const saved = (await this.loadSettings()).read();
      return {
        ok: true,
        data: {
          device: { ...(this.activeDevice ?? this.identity!.read()) },
          deviceName: this.identity!.read().deviceName,
          port: saved.port,
          networkAddress: saved.networkAddress,
          closeBehavior: saved.closeBehavior,
          themeSource: saved.themeSource,
          transfer: saved.transfer,
          pendingRestart:
            saved.saved &&
            (JSON.stringify(saved.transfer) !== JSON.stringify(this.activeTransfer) ||
              saved.port !== this.port ||
              saved.networkAddress !== this.networkAddress ||
              (!!this.activeDevice && this.identity!.read().deviceName !== this.activeDevice.deviceName)),
        },
      };
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '连接设置无效，请检查保留记录' };
    }
  }

  /**
   * Reports whether settings publication must finish before a complete restart can be admitted.
   */
  isSavingSettings(): boolean {
    return this.savingSettings;
  }

  /**
   * Persists UI preferences and next-start listeners without changing active tasks.
   */
  async saveSettings(input: SettingsInput): Promise<SettingsResponse> {
    if (this.savingSettings) {
      return { ok: false, code: 'UNAVAILABLE', message: '设置正在保存，请稍后重试' };
    }
    this.savingSettings = true;
    try {
      const settings = await this.loadSettings();
      await settings.save(input);
      if (input.deviceName !== undefined) {
        await this.identity!.rename(input.deviceName);
      }
      return this.readSettings();
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '设置保存未全部完成，请刷新后检查保留记录' };
    } finally {
      this.savingSettings = false;
    }
  }

  /**
   * Sends one finite Host operation to the owned Runtime; credentials never enter a lifecycle snapshot.
   */
  request(input: HostCommand, timeoutMs = 15000): Promise<z.infer<typeof hostReplySchema>> {
    const child = this.child;
    if (!child || this.snapshot.state !== 'ready' || this.requests.size >= 8) {
      return Promise.reject(new Error('执行服务不可用'));
    }
    const requestId = randomUUID();
    const message = hostRequestSchema.parse({ ...input, requestId });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error('授权请求超时，请刷新状态；请勿自动重试创建授权'));
      }, timeoutMs);
      this.requests.set(requestId, { resolve, reject, timer });
      try {
        child.postMessage(message);
      } catch {
        clearTimeout(timer);
        this.requests.delete(requestId);
        reject(new Error('执行服务连接中断'));
      }
    });
  }

  /**
   * Observes lifecycle transitions without owning the process lifetime.
   */
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Merges concurrent starts; readiness requires a validated child handshake.
   */
  start(): Promise<void> {
    if (this.starting) {
      return this.starting;
    }
    if (this.snapshot.state === 'ready') {
      return Promise.resolve();
    }
    if (this.child || this.stopping) {
      return Promise.reject(new Error('Runtime is still stopping.'));
    }
    this.update({
      state: 'starting',
      pid: null,
      startedAt: null,
      message: '执行服务正在启动',
      startupFailure: null,
      listenFailure: null,
    });
    this.starting = this.loadSettings()
      .then((settings) => {
        if (this.snapshot.state !== 'starting') {
          throw new Error('Runtime start was stopped.');
        }
        const saved = settings.read();
        if (saved.saved) {
          this.port = saved.port;
        }
        this.networkAddress = saved.networkAddress;
        this.activeDevice = this.identity!.read();
        this.activeTransfer = saved.transfer;
        return this.launch();
      })
      .catch((error: unknown) => {
        if (!this.child && this.snapshot.state === 'starting') {
          this.update({ state: 'failed', message: '执行服务启动失败，请检查设备身份、连接设置与端口' });
        }
        throw error;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  /**
   * Stops only the owned Utility Process and confirms its exit before resolving.
   */
  stop(): Promise<void> {
    this.clearHealthTimer();
    if (this.stopping) {
      return this.stopping;
    }
    const child = this.child;
    if (!child) {
      this.update({ state: 'stopped', pid: null, message: '执行服务已停止' });
      return Promise.resolve();
    }
    this.update({ state: 'stopping', message: '执行服务正在退出' });
    this.stopping = new Promise<void>((resolve, reject) => {
      const killTimer = setTimeout(() => {
        child.kill();
      }, 2_000);
      const deadline = setTimeout(() => {
        cleanup();
        this.update({ state: 'failed', message: '执行服务退出未获确认' });
        reject(new Error('Runtime exit was not confirmed.'));
      }, 5_000);
      /**
       * Releases shutdown-only timers and listeners on all completion paths.
       */
      const cleanup = () => {
        clearTimeout(killTimer);
        clearTimeout(deadline);
        child.removeListener('exit', onExit);
      };
      /**
       * Confirms termination independently of a shutdown acknowledgement.
       */
      const onExit = () => {
        cleanup();
        resolve();
      };
      child.once('exit', onExit);
      try {
        child.postMessage({ type: 'shutdown' });
      } catch {
        // A broken transport does not prove exit; keep the exit listener and deadline.
        child.kill();
      }
    }).finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  /**
   * Attaches lifecycle listeners before accepting the Runtime ready message.
   */
  private launch(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let child: UtilityProcess;
      try {
        child = utilityProcess.fork(
          this.entry,
          [
            this.userData,
            this.nativePath,
            String(this.port),
            this.networkAddress ?? '',
            JSON.stringify(this.activeDevice),
            JSON.stringify(this.activeTransfer),
            this.projectRoot,
          ],
          {
            stdio: 'pipe',
            serviceName: 'Dr.Octopus Executor Runtime',
          }
        );
      } catch {
        this.update({ state: 'failed', message: '执行服务无法启动' });
        reject(new Error('Runtime launch failed.'));
        return;
      }
      this.child = child;
      child.stdout?.resume();
      child.stderr?.on('data', () => {
        console.error('[executor] Runtime reported a diagnostic.');
      });
      child.on('message', (message: unknown) => {
        const activity = computerUseMessageSchema.safeParse(message);
        if (activity.success) {
          if (
            this.child === child &&
            activity.data.pid === child.pid &&
            (this.snapshot.state === 'ready' || this.snapshot.state === 'stopping') &&
            activity.data.activity.revision > this.snapshot.computerUse.revision
          ) {
            this.update({ computerUse: activity.data.activity });
          }
          return;
        }
        const result = hostReplySchema.safeParse(message);
        if (!result.success) {
          return;
        }
        const pending = this.requests.get(result.data.requestId);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        this.requests.delete(result.data.requestId);
        if (this.child === child && this.snapshot.state === 'ready') {
          this.update({ capabilities: { ...this.snapshot.capabilities, computer: result.data.computer } });
        }
        pending.resolve(result.data);
      });
      let settled = false;
      let startupTimedOut = false;
      const timer = setTimeout(() => {
        settled = true;
        startupTimedOut = true;
        child.removeListener('message', onMessage);
        this.update({ state: 'failed', message: '执行服务启动超时' });
        child.kill();
        reject(new Error('Runtime startup timed out.'));
      }, 45_000);
      /**
       * Accepts readiness only from this child and the matching process identity.
       */
      const onMessage = (message: unknown) => {
        const result = runtimeMessageSchema.safeParse(message);
        if (
          result.success &&
          result.data.type === 'startup-failed' &&
          this.child === child &&
          !settled &&
          this.snapshot.state === 'starting'
        ) {
          this.update({
            startupFailure: result.data.code,
            listenFailure: result.data.listenFailure,
            message: '执行服务初始化失败',
          });
          try {
            child.postMessage({ type: 'startup-failed-ack' });
          } catch {
            // Retain the diagnostic even if the child has already disconnected; its exit remains authoritative.
          }
          return;
        }
        if (
          !result.success ||
          result.data.type !== 'ready' ||
          result.data.pid !== child.pid ||
          this.snapshot.startupFailure !== null ||
          this.snapshot.state !== 'starting'
        ) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        child.removeListener('message', onMessage);
        this.update({
          state: 'ready',
          pid: result.data.pid,
          startedAt: result.data.startedAt,
          message: '执行服务已启动',
          health: { state: 'healthy', checkedAt: new Date().toISOString() },
          capabilities: {
            ...this.snapshot.capabilities,
            basic: { available: true, reason: '基础工具服务已就绪，调用前需本地授权' },
            computer: result.data.computer,
          },
        });
        this.healthTimer = setInterval(() => {
          void this.checkHealth();
        }, 5000);
        this.healthTimer.unref();
        resolve();
      };
      child.on('message', onMessage);
      child.once('exit', (code) => {
        clearTimeout(timer);
        child.removeListener('message', onMessage);
        this.child = null;
        for (const pending of this.requests.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('执行服务连接中断'));
        }
        this.requests.clear();
        const expected = this.snapshot.state === 'stopping';
        if (this.snapshot.computerUse.state !== 'idle') {
          this.update({
            computerUse: {
              ...this.snapshot.computerUse,
              revision: this.snapshot.computerUse.revision + 1,
              state: 'unknown',
            },
          });
        }
        let exitMessage = '执行服务意外退出';
        if (expected) {
          exitMessage = '执行服务已停止';
        } else if (startupTimedOut) {
          exitMessage = '执行服务启动超时';
        } else if (this.snapshot.startupFailure) {
          exitMessage = this.snapshot.message;
        }
        this.update({
          state: expected ? 'stopped' : 'failed',
          pid: null,
          message: exitMessage,
        });
        if (!settled) {
          settled = true;
          reject(new Error('Runtime exited before readiness: ' + code));
        }
      });
    });
  }

  /**
   * Advances the revision once per lifecycle change and publishes detached DTOs.
   */
  private update(change: Partial<RuntimeSnapshot>): void {
    if (change.state && change.state !== 'ready') {
      this.clearHealthTimer();
      change.health = { state: 'unknown', checkedAt: null };
      change.capabilities = {
        ...this.snapshot.capabilities,
        basic: { available: false, reason: '执行服务未就绪' },
        browser: { available: false, reason: '执行服务未就绪' },
        computer: {
          state: change.state === 'starting' ? 'starting' : 'stopped',
          available: false,
          reason: change.state === 'starting' ? '等待执行服务与桌面后端启动' : '执行服务未就绪',
        },
      };
    }
    this.snapshot = { ...this.snapshot, ...change, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) {
      listener(this.readStatus());
    }
  }

  /**
   * Probes the owned Runtime even without windows, with one five-second request and no replay or restart.
   */
  private async checkHealth(): Promise<void> {
    if (this.checkingHealth || this.snapshot.state !== 'ready') {
      return;
    }
    this.checkingHealth = true;
    const child = this.child;
    let healthy: boolean;
    let browserAvailable = false;
    let computer: RuntimeSnapshot['capabilities']['computer'] = {
      state: 'unavailable',
      available: false,
      reason: '执行服务暂未响应，无法确认桌面工具状态',
    };
    try {
      const reply = await this.request({ type: 'access-list' }, 5000);
      healthy = reply.response.ok && !!reply.response.data.endpoint;
      if (healthy) {
        computer = reply.computer;
      }
      browserAvailable =
        reply.response.ok &&
        reply.response.data.browser.enabled &&
        reply.response.data.browser.connections.some(
          (item) => item.state === 'connected' && item.toolsAvailable
        );
    } catch {
      healthy = false;
    } finally {
      this.checkingHealth = false;
    }
    if (this.child === child && this.snapshot.state === 'ready') {
      this.update({
        health: { state: healthy ? 'healthy' : 'unresponsive', checkedAt: new Date().toISOString() },
        capabilities: {
          ...this.snapshot.capabilities,
          computer,
          browser: {
            available: browserAvailable,
            reason: browserAvailable ? '浏览器工具就绪，网站权限逐次校验' : '未有可用的浏览器工具连接',
          },
        },
      });
    }
  }

  /**
   * Releases only this manager's health timer on every stop or loss of readiness.
   */
  private clearHealthTimer(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }
}
