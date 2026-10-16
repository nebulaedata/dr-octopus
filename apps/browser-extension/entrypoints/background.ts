/**
 * @author Codex
 * @description Owns one Native Messaging connection, finite handshakes and alarm-backed connection-only retries.
 */
import { BrowserRouter } from '../src/browser-router';
import { browserResultSchema, browserErrorSchema } from '@octopus/shared/protocol/browser-tools';
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { bridgeFailureSchema, popupRequestSchema, type PopupStatus } from '../src/popup-bridge';
import {
  browserHostName,
  bridgeVersion,
  extensionMessageSchema,
  hostMessageSchema,
} from '@octopus/shared/protocol/browser-bridge';

export default defineBackground({
  type: 'module',
  /**
   * Registers synchronous lifecycle listeners before starting asynchronous initialization.
   */
  main() {
    const router = new BrowserRouter();
    const seen = new Set<string>();
    let pending = 0;
    let port: ReturnType<typeof browser.runtime.connectNative> | null = null;
    let connecting = false;
    let failures = 0;
    let connectionId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const retries = 'octopus-bridge-retry';
    const heartbeat = 'octopus-bridge-heartbeat';
    let handshakeId: string | null = null;
    let pauseRevision = 0;
    let paused = false;
    let statusCode = 'connecting';
    const executing = new Map<string, string>();
    /**
     * Publishes diagnostics only; live connection authority remains in this worker.
     */
    async function publishStatus(code: string) {
      statusCode = code;
      await browser.storage.local.set({ bridgeStatus: code });
    }
    /**
     * Reads current pause preference and worker evidence instead of trusting a persisted connected label.
     */
    async function popupStatus(): Promise<PopupStatus> {
      const saved = await browser.storage.local.get(['paused', 'installationId', 'bridgeLastFailure']);
      const failure = bridgeFailureSchema.safeParse(saved.bridgeLastFailure);
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
        lastFailure: failure.success ? failure.data : null,
      };
    }
    /**
     * Clears only this worker's handshake deadline and port reference.
     */
    function detach() {
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
      await browser.alarms.clear(heartbeat);
      await publishStatus(code);
      const { paused } = await browser.storage.local.get('paused');
      if (!paused) {
        await browser.alarms.create(retries, {
          delayInMinutes: Math.min(5, 0.5 * 2 ** Math.min(failures++, 4)),
        });
      }
    }
    /**
     * Merges connection attempts and sends one versioned installation handshake.
     */
    async function ensure() {
      if (connecting || port) {
        return;
      }
      connecting = true;
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
        const current = browser.runtime.connectNative(browserHostName);
        port = current;
        current.onDisconnect.addListener(() => {
          // Reading lastError consumes Chrome's diagnostic without persisting user paths.
          const message = browser.runtime.lastError?.message;
          const reason = !message
            ? null
            : /not found/i.test(message)
              ? 'host_not_found'
              : /forbidden|not allowed/i.test(message)
                ? 'access_forbidden'
                : /exited/i.test(message)
                  ? 'host_exited'
                  : 'native_error';
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
          const result = hostMessageSchema.safeParse(value);
          if (!result.success) {
            const method = value && typeof value === 'object' && 'method' in value ? value.method : null;
            void retry('invalid_message', method).catch(() => {});
            return;
          }
          if (result.data.type === 'connected') {
            if (result.data.requestId !== handshakeId || connectionId) {
              void retry('invalid_handshake').catch(() => {});
              return;
            }
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            connectionId = result.data.connectionId;
            failures = 0;
            void publishStatus('connected').catch(() => {});
            void browser.alarms.create(heartbeat, { periodInMinutes: 0.5 }).catch(() => {});
          } else if (result.data.type === 'request' || result.data.type === 'release') {
            const command = result.data;
            if (command.connectionId !== connectionId || seen.has(command.requestId) || pending >= 8) {
              void retry('invalid_request').catch(() => {});
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
          } else if (result.data.type === 'error') {
            void retry(result.data.code).catch(() => {});
          } else if (result.data.connectionId !== connectionId) {
            void retry('stale_connection').catch(() => {});
          }
        });
        timer = setTimeout(() => {
          if (port === current && !connectionId) {
            void retry('handshake_timeout').catch(() => {});
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
          })
        );
      } catch {
        await retry('native_host_unavailable');
      } finally {
        connecting = false;
        if (revision !== pauseRevision && !paused) {
          void ensure().catch(() => {});
        }
      }
    }
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === retries) {
        void ensure().catch(() => {});
      }
      if (alarm.name === heartbeat && port && connectionId) {
        port.postMessage({ type: 'heartbeat', requestId: crypto.randomUUID(), connectionId });
      }
    });
    browser.runtime.onStartup.addListener(() => {
      void ensure().catch(() => {});
    });
    browser.runtime.onInstalled.addListener(() => {
      void ensure().catch(() => {});
    });
    browser.runtime.onMessage.addListener((message: unknown, sender) => {
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
          await ensure();
        }
        return popupStatus();
      })();
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.paused) {
        return;
      }
      pauseRevision++;
      paused = Boolean(changes.paused.newValue);
      if (changes.paused.newValue) {
        const current = port;
        detach();
        current?.disconnect();
        void publishStatus('paused').catch(() => {});
        void browser.alarms.clear(retries);
        void browser.alarms.clear(heartbeat);
      } else {
        void ensure().catch(() => {});
      }
    });
    void ensure().catch(() => {});
  },
});
