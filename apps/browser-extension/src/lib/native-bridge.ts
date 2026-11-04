/**
 * @author Codex
 * @description Owns the Native session, bounded connection retries and popup diagnostics independently of Agent and recording services.
 */
import { browser } from 'wxt/browser';
import { browserResultSchema, browserErrorSchema } from '@octopus/shared/protocol/browser-tools';
import {
  bridgeVersion,
  extensionMessageSchema,
  hostMessageSchema,
} from '@octopus/shared/protocol/browser-bridge';
import type { BrowserSkillRequest } from '@octopus/shared/protocol/browser-skills';
import type { BrowserRouter } from '../browser-router';
import {
  bridgeFailureSchema,
  popupRequestSchema,
  popupStatusSchema,
  type PopupStatus,
} from '../popup-bridge';

declare const __OCTOPUS_BROWSER_HOST__: string;
declare const __OCTOPUS_EXTENSION_BUILD_ID__: string;

type Replies = {
  /**
   * Consumes only a matching file reply.
   */
  receive(value: unknown): boolean;
  /**
   * Ends pending file requests without replay.
   */
  disconnect(): void;
};

/**
 * Creates an inert connection owner; background installs business receivers before start.
 */
export function createNativeBridge(router: Pick<BrowserRouter, 'execute' | 'reset'>) {
  let skillFiles: Replies;
  let started = false;
  let disposed = false;
  let generation = 0;
  let lastMessageAt = 0;
  const cleanups: (() => void)[] = [];
  /**
   * Registers one owned event subscription and retains its matching cleanup.
   */
  function listen<Args extends unknown[]>(
    event: {
      addListener(listener: (...args: Args) => void): void;
      removeListener(listener: (...args: Args) => void): void;
    },
    listener: (...args: Args) => void
  ) {
    event.addListener(listener);
    cleanups.push(() => event.removeListener(listener));
  }
  const seen = new Set<string>();
  let pending = 0;
  let port: ReturnType<typeof browser.runtime.connectNative> | null = null;
  let connecting = false;
  let failures = 0;
  let connectionId: string | null = null;
  let lastConnectedAt: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const retries = 'octopus-bridge-retry';
  const heartbeat = 'octopus-bridge-heartbeat';
  let handshakeId: string | null = null;
  let pauseRevision = 0;
  let paused = false;
  let statusCode = 'connecting';
  const executing = new Map<string, string>();
  /**
   * Reports bookkeeping failure without logging Native error text, page content or user paths.
   */
  function reportFailure(): void {
    console.warn('Native bridge state update failed.');
  }
  /**
   * Publishes diagnostics only; live connection authority remains in this worker.
   */
  async function publishStatus(code: string) {
    statusCode = code;
    await browser.storage.local.set({ bridgeStatus: code });
  }
  /**
   * Records a successful handshake once; heartbeats never advance the last connection time.
   */
  async function publishConnected() {
    statusCode = 'connected';
    lastConnectedAt = new Date().toISOString();
    await browser.storage.local.set({ bridgeStatus: statusCode, bridgeLastConnectedAt: lastConnectedAt });
  }
  /**
   * Reads current pause preference and worker evidence instead of trusting a persisted connected label.
   */
  async function popupStatus(): Promise<PopupStatus> {
    const saved = await browser.storage.local.get([
      'paused',
      'installationId',
      'bridgeLastFailure',
      'bridgeLastConnectedAt',
    ]);
    const failure = bridgeFailureSchema.safeParse(saved.bridgeLastFailure);
    const previousConnection = popupStatusSchema.shape.lastConnectedAt.safeParse(saved.bridgeLastConnectedAt);
    let phase: PopupStatus['phase'] = 'disconnected';
    if (saved.paused) {
      phase = 'paused';
    } else if (connectionId) {
      phase = 'connected';
    } else if (statusCode === 'VERSION_INCOMPATIBLE') {
      phase = 'incompatible';
    } else if (connecting || statusCode === 'connecting') {
      phase = 'connecting';
    }
    return {
      phase,
      code: statusCode,
      toolsReady: phase === 'connected',
      installationId: typeof saved.installationId === 'string' ? saved.installationId : null,
      lastConnectedAt: lastConnectedAt ?? (previousConnection.success ? previousConnection.data : null),
      lastFailure: failure.success ? failure.data : null,
    };
  }
  /**
   * Clears only this worker's handshake deadline and port reference.
   */
  function detach() {
    skillFiles.disconnect();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    router.reset();
    seen.clear();
    executing.clear();
    port = null;
    connectionId = null;
    handshakeId = null;
  }
  /**
   * Writes safe status and schedules capped connection retries, never tool calls.
   */
  async function retry(
    code: string,
    method: unknown = [...executing.values()].at(-1) ?? null,
    nativeReason: 'host_exited' | 'host_not_found' | 'access_forbidden' | 'native_error' | null = null
  ) {
    const revision = ++generation;
    const parsedMethod = bridgeFailureSchema.shape.method.safeParse(method);
    const failure = bridgeFailureSchema.parse({
      at: new Date().toISOString(),
      code,
      method: parsedMethod.success ? parsedMethod.data : null,
      nativeReason,
    });
    const previous = port;
    detach();
    previous?.disconnect();
    await browser.storage.local.set({ bridgeLastFailure: failure });
    if (disposed || revision !== generation || paused) {
      return;
    }
    await browser.alarms.clear(heartbeat);
    if (disposed || revision !== generation || paused) {
      return;
    }
    await publishStatus(code);
    const saved = await browser.storage.local.get('paused');
    if (!saved.paused && !paused && !disposed && revision === generation) {
      await browser.alarms.create(retries, {
        delayInMinutes: Math.min(5, 0.5 * 2 ** Math.min(failures++, 4)),
      });
    }
  }
  /**
   * Merges connection attempts and sends one versioned installation handshake.
   */
  async function ensure() {
    if (disposed || connecting || port) {
      return;
    }
    connecting = true;
    generation++;
    const revision = pauseRevision;
    try {
      const saved = await browser.storage.local.get(['installationId', 'paused']);
      if (revision !== pauseRevision) {
        return;
      }
      paused = Boolean(saved.paused);
      if (saved.paused) {
        await publishStatus('paused');
        return;
      }
      const installationId =
        typeof saved.installationId === 'string' ? saved.installationId : crypto.randomUUID();
      await browser.storage.local.set({ installationId });
      if (revision !== pauseRevision || paused) {
        return;
      }
      await publishStatus('connecting');
      if (revision !== pauseRevision || paused) {
        return;
      }
      const current = browser.runtime.connectNative(__OCTOPUS_BROWSER_HOST__);
      port = current;
      current.onDisconnect.addListener(() => {
        // Reading lastError consumes Chrome's diagnostic without persisting user paths.
        const message = browser.runtime.lastError?.message;
        let reason: 'host_exited' | 'host_not_found' | 'access_forbidden' | 'native_error' | null = null;
        if (message) {
          if (/not found/i.test(message)) {
            reason = 'host_not_found';
          } else if (/forbidden|not allowed/i.test(message)) {
            reason = 'access_forbidden';
          } else if (/exited/i.test(message)) {
            reason = 'host_exited';
          } else {
            reason = 'native_error';
          }
        }
        if (port === current) {
          void retry(connectionId ? 'disconnected' : 'native_host_unavailable', undefined, reason).catch(
            () => {}
          );
        }
      });
      current.onMessage.addListener((value: unknown) => {
        if (port !== current) {
          return;
        }
        lastMessageAt = Date.now();
        if (skillFiles.receive(value)) {
          return;
        }
        const result = hostMessageSchema.safeParse(value);
        if (!result.success) {
          const method = value && typeof value === 'object' && 'method' in value ? value.method : null;
          void retry('invalid_message', method).catch(reportFailure);
          return;
        }
        if (result.data.type === 'connected') {
          if (result.data.requestId !== handshakeId || connectionId) {
            void retry('invalid_handshake').catch(reportFailure);
            return;
          }
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          connectionId = result.data.connectionId;
          failures = 0;
          void publishConnected().catch(reportFailure);
          void browser.alarms.create(heartbeat, { periodInMinutes: 0.5 }).catch(reportFailure);
        } else if (result.data.type === 'request' || result.data.type === 'release') {
          const command = result.data;
          if (command.connectionId !== connectionId || seen.has(command.requestId) || pending >= 8) {
            void retry('invalid_request').catch(reportFailure);
            return;
          }
          seen.add(command.requestId);
          if (seen.size > 256) {
            seen.delete(seen.values().next().value!);
          }
          pending++;
          if (command.type === 'request') {
            executing.set(command.requestId, command.method);
          }
          void router
            .execute(command)
            .then((value) => {
              const pageReply =
                value && typeof value === 'object' && ('result' in value || 'error' in value)
                  ? value
                  : { result: value };
              if (port === current && connectionId === command.connectionId) {
                const reply = browserResultSchema.parse({
                  type: 'result',
                  requestId: command.requestId,
                  connectionId: command.connectionId,
                  ...pageReply,
                });
                if (new TextEncoder().encode(JSON.stringify(reply)).length > 256 * 1024) {
                  throw new Error('PAYLOAD_TOO_LARGE');
                }
                current.postMessage(reply);
              }
            })
            .catch((error) => {
              const parsed = browserErrorSchema.safeParse(
                error instanceof Error ? error.message : 'OUTCOME_UNKNOWN'
              );
              if (port === current && connectionId === command.connectionId) {
                current.postMessage({
                  type: 'result',
                  requestId: command.requestId,
                  connectionId: command.connectionId,
                  error: parsed.success ? parsed.data : 'OUTCOME_UNKNOWN',
                });
              }
            })
            .finally(() => {
              executing.delete(command.requestId);
              pending--;
            });
        } else if (result.data.type === 'probe-result') {
          void retry('invalid_message').catch(() => console.warn('Bridge diagnostic persistence failed.'));
        } else if (result.data.type === 'error') {
          void retry(result.data.code).catch(reportFailure);
        } else if (result.data.connectionId !== connectionId) {
          void retry('stale_connection').catch(reportFailure);
        }
      });
      timer = setTimeout(() => {
        if (port === current && !connectionId) {
          void retry('handshake_timeout').catch(reportFailure);
        }
      }, 10000);
      handshakeId = crypto.randomUUID();
      current.postMessage(
        extensionMessageSchema.parse({
          type: 'hello',
          requestId: handshakeId,
          version: bridgeVersion,
          tools: true,
          installationId,
          browser: import.meta.env.BROWSER === 'edge' ? 'edge' : 'chrome',
          extensionVersion: browser.runtime.getManifest().version,
          extensionBuildId: __OCTOPUS_EXTENSION_BUILD_ID__,
        })
      );
    } catch {
      await retry('native_host_unavailable');
    } finally {
      connecting = false;
      if (revision !== pauseRevision && !paused) {
        void ensure().catch(reportFailure);
      }
    }
  }
  /**
   * Starts listeners once after the composition root has supplied file-request cleanup.
   */
  function start(replies: Replies) {
    if (started) {
      throw new Error('Native bridge already started');
    }
    if (disposed) {
      throw new Error('Native bridge disposed');
    }
    started = true;
    skillFiles = replies;
    listen(browser.alarms.onAlarm, (alarm) => {
      if (alarm.name === retries) {
        void ensure().catch(reportFailure);
      }
      if (alarm.name === heartbeat && port && connectionId) {
        if (Date.now() - lastMessageAt > 45000) {
          void retry('heartbeat_timeout').catch(() =>
            console.warn('Bridge recovery status could not be saved.')
          );
          return;
        }
        try {
          port.postMessage({ type: 'heartbeat', requestId: crypto.randomUUID(), connectionId });
        } catch {
          void retry('disconnected').catch(() => console.warn('Bridge recovery status could not be saved.'));
        }
      }
    });
    listen(browser.runtime.onStartup, () => {
      void ensure().catch(reportFailure);
    });
    listen(browser.runtime.onInstalled, () => {
      void ensure().catch(reportFailure);
    });
    listen(browser.runtime.onMessage, (message: unknown, sender) => {
      if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('/popup.html')) {
        return;
      }
      const parsed = popupRequestSchema.safeParse(message);
      if (!parsed.success) {
        return;
      }
      return (async () => {
        if (parsed.data.type === 'bridge.pause') {
          await browser.storage.local.set({ paused: parsed.data.paused });
        } else if (parsed.data.type === 'bridge.reconnect') {
          await browser.alarms.clear(retries);
          if (!paused) {
            const current = port;
            generation++;
            detach();
            current?.disconnect();
          }
          await ensure();
        }
        return popupStatus();
      })();
    });
    listen(browser.storage.onChanged, (changes, area) => {
      if (area !== 'local' || !changes.paused) {
        return;
      }
      pauseRevision++;
      generation++;
      paused = Boolean(changes.paused.newValue);
      if (changes.paused.newValue) {
        const current = port;
        detach();
        current?.disconnect();
        void publishStatus('paused').catch(reportFailure);
        void browser.alarms.clear(retries).catch(reportFailure);
        void browser.alarms.clear(heartbeat).catch(reportFailure);
      } else {
        void ensure().catch(reportFailure);
      }
    });
    void ensure().catch(reportFailure);
  }
  /**
   * Captures one authenticated session; a retained sender can never target a replacement port.
   */
  function getSession() {
    const current = port;
    const id = connectionId;
    if (!current || !id) {
      return undefined;
    }
    return {
      id,
      /**
       * Rejects sends retained by a consumer after this authenticated session ends.
       */
      post(request: BrowserSkillRequest) {
        if (port !== current || connectionId !== id || request.connectionId !== id) {
          throw new Error('SKILL_OFFLINE');
        }
        current.postMessage(request);
      },
    };
  }
  /**
   * Stops this owner's subscriptions and connection without replaying business operations.
   */
  async function dispose() {
    disposed = true;
    generation++;
    pauseRevision++;
    paused = true;
    const current = port;
    if (started) {
      detach();
    }
    current?.disconnect();
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    await Promise.all([browser.alarms.clear(retries), browser.alarms.clear(heartbeat)]);
  }
  return { start, dispose, getSession, readStatus: popupStatus };
}
