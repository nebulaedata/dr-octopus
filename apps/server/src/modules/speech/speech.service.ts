/**
 * @author Codex
 * @description Owns speech enablement, credential redaction, serialized settings writes and bounded ASR requests.
 */
import { speechMaxAudioBytes, speechSettingsUpdateSchema } from '@octopus/shared/protocol';
import type { SpeechSettingsDto, SpeechSettingsUpdate } from '@octopus/shared/protocol';
import type { SpeechRepository } from './speech.repository.js';

export class SpeechError extends Error {
  /**
   * Carries a safe domain code without upstream response bodies or credentials.
   */
  constructor(readonly code: string) {
    super(code);
  }
}

const audioExtensions: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
};

export class SpeechService {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly active = new Map<AbortController, Promise<void>>();
  private closed = false;
  /**
   * Borrows persistence and the HTTP transport; the module owns service shutdown.
   */
  constructor(
    private readonly repository: SpeechRepository,
    private readonly fetcher = fetch
  ) {}
  /**
   * Returns settings with only credential presence exposed to the browser.
   */
  async get(): Promise<SpeechSettingsDto> {
    const { config, revision } = await this.repository.read();
    const { apiKey: openaiKey, ...openai } = config.providers.openai;
    const { apiKey: qwenKey, ...qwen } = config.providers.qwen;
    return {
      enabled: config.enabled,
      activeProvider: config.activeProvider,
      revision,
      providers: {
        openai: { ...openai, hasApiKey: Boolean(openaiKey) },
        qwen: { ...qwen, hasApiKey: Boolean(qwenKey) },
      },
    };
  }
  /**
   * Serializes revision checks and commits; omitted credentials retain the saved key, null clears it.
   */
  update(input: SpeechSettingsUpdate): Promise<SpeechSettingsDto> {
    const work = this.writes.then(async () => {
      if (this.closed) {
        throw new SpeechError('SPEECH_DISABLED');
      }
      const parsed = speechSettingsUpdateSchema.safeParse(input);
      if (!parsed.success) {
        throw new SpeechError('SPEECH_INVALID');
      }
      const current = await this.repository.read();
      if (current.revision !== input.revision) {
        throw new SpeechError('SPEECH_CONFLICT');
      }
      const { provider, enabled, activeProvider } = parsed.data;
      const settings = current.config;
      settings.enabled = enabled ?? settings.enabled;
      settings.activeProvider = activeProvider ?? settings.activeProvider;
      if (provider) {
        const { id, apiKey, ...configuration } = provider;
        settings.providers[id] = {
          ...configuration,
          apiKey: apiKey === undefined ? settings.providers[id].apiKey : (apiKey ?? ''),
        };
      }
      if (settings.enabled && settings.activeProvider === 'qwen' && !settings.providers.qwen.apiKey) {
        throw new SpeechError('SPEECH_KEY_REQUIRED');
      }
      await this.repository.write(settings);
      if (!settings.enabled) {
        this.active.forEach((_completion, controller) => controller.abort());
      }
      return this.get();
    });
    this.writes = work.catch(() => undefined);
    return work;
  }
  /**
   * Transcribes one bounded audio clip with the saved model; audio stays in memory and is never retried.
   */
  async transcribe(audio: Buffer, contentType: string, signal: AbortSignal) {
    const extension = audioExtensions[contentType.split(';')[0]!.trim().toLowerCase()];
    if (!extension || !audio.length || audio.length > speechMaxAudioBytes) {
      throw new SpeechError('SPEECH_AUDIO_INVALID');
    }
    const { config } = await this.repository.read();
    if (!config.enabled || this.closed) {
      throw new SpeechError('SPEECH_DISABLED');
    }
    if (this.active.size >= 4) {
      throw new SpeechError('SPEECH_BUSY');
    }
    const controller = new AbortController();
    let complete!: () => void;
    this.active.set(
      controller,
      new Promise<void>((resolve) => {
        complete = resolve;
      })
    );
    const timeout = AbortSignal.timeout(60_000);
    try {
      const provider = config.providers[config.activeProvider];
      const headers: Record<string, string> = provider.apiKey
        ? { Authorization: `Bearer ${provider.apiKey}` }
        : {};
      let body: FormData | string;
      let endpoint: string;
      if (config.activeProvider === 'qwen') {
        if (!provider.apiKey) {
          throw new SpeechError('SPEECH_KEY_REQUIRED');
        }
        // DashScope limits inline Base64 audio to 10 MB, including encoding overhead.
        if (4 * Math.ceil(audio.length / 3) > speechMaxAudioBytes) {
          throw new SpeechError('SPEECH_AUDIO_TOO_LARGE');
        }
        endpoint = '/services/aigc/multimodal-generation/generation';
        headers['Content-Type'] = 'application/json';
        headers['X-DashScope-SSE'] = 'disable';
        body = JSON.stringify({
          model: provider.model,
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'input_audio',
                    input_audio: {
                      data: `data:${contentType.split(';')[0]!.trim().toLowerCase()};base64,${audio.toString('base64')}`,
                    },
                  },
                ],
              },
            ],
          },
          parameters: { format: extension },
        });
      } else {
        endpoint = '/audio/transcriptions';
        const form = new FormData();
        form.append(
          'file',
          new Blob([new Uint8Array(audio)], { type: contentType }),
          `recording.${extension}`
        );
        form.append('model', provider.model);
        form.append('response_format', 'json');
        body = form;
      }
      const response = await this.fetcher(`${provider.baseUrl.replace(/\/+$/, '')}${endpoint}`, {
        method: 'POST',
        body,
        redirect: 'error',
        headers,
        signal: AbortSignal.any([signal, controller.signal, timeout]),
      });
      if (!response.ok) {
        throw new SpeechError('SPEECH_REQUEST_FAILED');
      }
      let result: unknown = await response.json();
      if (config.activeProvider === 'qwen' && result && typeof result === 'object' && 'output' in result) {
        result = result.output;
      } else if (config.activeProvider === 'qwen') {
        throw new SpeechError('SPEECH_RESPONSE_INVALID');
      }
      if (
        !result ||
        typeof result !== 'object' ||
        !('text' in result) ||
        typeof result.text !== 'string' ||
        result.text.length > 100_000
      ) {
        throw new SpeechError('SPEECH_RESPONSE_INVALID');
      }
      if (signal.aborted || controller.signal.aborted) {
        throw new SpeechError('SPEECH_CANCELLED');
      }
      return { text: result.text.trim() };
    } catch (error) {
      if (timeout.aborted) {
        throw new SpeechError('SPEECH_TIMEOUT');
      }
      if (signal.aborted || controller.signal.aborted) {
        throw new SpeechError('SPEECH_CANCELLED');
      }
      if (error instanceof SpeechError) {
        throw error;
      }
      throw new SpeechError('SPEECH_REQUEST_FAILED');
    } finally {
      this.active.delete(controller);
      complete();
    }
  }
  /**
   * Cancels in-flight provider calls and drains configuration writes when the Host closes.
   */
  async close() {
    this.closed = true;
    this.active.forEach((_completion, controller) => controller.abort());
    await Promise.all([this.writes, ...this.active.values()]);
  }
}
