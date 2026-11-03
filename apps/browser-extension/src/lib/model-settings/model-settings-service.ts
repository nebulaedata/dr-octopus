/**
 * @author Codex
 * @description Serves one page-bound model-settings request per authenticated extension-page port without creating agent sessions.
 */
import { browser } from 'wxt/browser';
import { modelSettingsRequestSchema, modelSettingsSchema } from './model-settings-messages';
import { ModelSettingsRepository } from './model-settings-repository';
import { discoverModels } from './model-discovery';
import { probeModelConnection } from './model-provider';

type Port = ReturnType<typeof browser.runtime.connect>;

/**
 * Uses the browser port lifetime as ownership; provider requests terminate on page disconnect or deadline.
 */
export class ModelSettingsService {
  /**
   * Shares credential ownership with the built-in agent service while keeping connection tests out of agent sessions.
   */
  constructor(private readonly settings: ModelSettingsRepository) {}

  /**
   * Accepts only the extension's Popup and identified window-panel pages, never content scripts or foreign documents.
   */
  connect(port: Port): void {
    if (port.name !== 'octopus-model-settings') {
      return;
    }
    const source = port.sender?.url ?? '';
    const panelPrefix = browser.runtime.getURL('/window-panel.html') + '?instance=';
    const panelSource =
      source.startsWith(panelPrefix) && /^[0-9a-f-]{36}$/i.test(source.slice(panelPrefix.length));
    if (
      port.sender?.id !== browser.runtime.id ||
      (source !== browser.runtime.getURL('/popup.html') && !panelSource)
    ) {
      port.disconnect();
      return;
    }
    const controller = new AbortController();
    let used = false;
    let disconnected = false;
    port.onDisconnect.addListener(() => {
      disconnected = true;
      controller.abort();
    });
    port.onMessage.addListener((message: unknown) => {
      if (used) {
        return;
      }
      used = true;
      void this.run(message, controller).then((reply) => {
        if (!disconnected) {
          try {
            port.postMessage(reply);
          } catch {
            controller.abort();
          }
        }
      });
    });
  }

  /**
   * Resolves credentials only after validation; replies contain metadata or stable error codes, never secrets.
   */
  private async run(message: unknown, controller: AbortController): Promise<unknown> {
    const parsed = modelSettingsRequestSchema.safeParse(message);
    if (!parsed.success) {
      return { ok: false, error: 'MODEL_INVALID' };
    }
    const request = parsed.data;
    let timeout = false;
    const timer = setTimeout(() => {
      timeout = true;
      controller.abort();
    }, 30000);
    const credential = { value: '' };
    try {
      if (request.type === 'settings-snapshot') {
        return { ok: true, value: await this.settings.snapshot() };
      }
      if (request.type === 'settings-read') {
        const saved = modelSettingsSchema.safeParse(
          (await browser.storage.local.get('workflowSettings')).workflowSettings
        );
        return { ok: true, value: saved.success ? saved.data : null };
      }
      if (request.type === 'settings-save') {
        await this.settings.save(
          request.settings,
          request.apiKey,
          request.consent,
          request.expectedRevision,
          request.limits
        );
        return { ok: true, value: true };
      }
      if (request.type === 'credential-status') {
        return {
          ok: true,
          value: {
            hasKey: await this.settings.hasCredential(request.baseUrl),
            canSend: await this.settings.canSend(request.baseUrl),
          },
        };
      }
      if (request.type === 'credential-clear') {
        await this.settings.clear(request.baseUrl, request.expectedRevision);
        return { ok: true, value: true };
      }
      const endpoint = request.type === 'test' ? request.settings.baseUrl : request.baseUrl;
      credential.value = await this.settings.resolve(endpoint, request.apiKey);
      request.apiKey = undefined;
      controller.signal.throwIfAborted();
      const value =
        request.type === 'test'
          ? await probeModelConnection(request.settings, credential.value, controller.signal)
          : await discoverModels(endpoint, credential.value, controller.signal);
      return { ok: true, value };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      return {
        ok: false,
        error: timeout
          ? 'MODEL_TIMEOUT'
          : [
                'SETTINGS_CONFLICT',
                'MODEL_AUTH',
                'MODEL_NOT_FOUND',
                'MODEL_CONFIGURATION',
                'MODEL_RATE_LIMIT',
                'MODEL_UNAVAILABLE',
                'MODEL_EMPTY',
                'WORKFLOW_STORAGE',
              ].includes(code)
            ? code
            : 'MODEL_FAILED',
      };
    } finally {
      credential.value = '';
      if ('apiKey' in request) {
        request.apiKey = undefined;
      }
      clearTimeout(timer);
    }
  }
}
