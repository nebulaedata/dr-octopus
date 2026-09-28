/**
 * @author Codex
 * @description Exposes validated speech settings and binary audio transcription with localized safe errors.
 * GET /api/settings/speech
 * PUT /api/settings/speech
 * POST /api/speech/transcriptions
 */
import { speechMaxAudioBytes, speechSettingsUpdateSchema } from '@octopus/shared/protocol';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { SpeechError } from './speech.service.js';
import type { SpeechService } from './speech.service.js';
import type { FastifyInstance } from 'fastify';

export const speechErrorMessages = {
  SPEECH_KEY_REQUIRED: {
    en: 'Add a Qwen API key before enabling this service.',
    'zh-CN': '启用 Qwen 服务前，请先配置百炼 API Key。',
  },
  SPEECH_AUDIO_TOO_LARGE: {
    en: 'This recording exceeds the Qwen inline audio limit. Record a shorter clip.',
    'zh-CN': '录音超过 Qwen 内联音频限制，请缩短录音后重试。',
  },
  SPEECH_INVALID: { en: 'Check the speech service URL and model.', 'zh-CN': '请检查语音服务地址和模型。' },
  SPEECH_CONFLICT: {
    en: 'Speech settings changed. Reload before saving.',
    'zh-CN': '语音配置已变更，请重新加载后保存。',
  },
  SPEECH_IO: { en: 'Could not read or save speech settings.', 'zh-CN': '无法读取或保存语音配置。' },
  SPEECH_DISABLED: {
    en: 'Enable the speech service in Settings first.',
    'zh-CN': '请先在系统设置中开启语音服务。',
  },
  SPEECH_BUSY: {
    en: 'The speech service is busy. Try again shortly.',
    'zh-CN': '语音服务繁忙，请稍后重试。',
  },
  SPEECH_AUDIO_INVALID: {
    en: 'Audio is empty, unsupported, or exceeds 10 MB.',
    'zh-CN': '音频为空、格式不支持或超过 10 MB。',
  },
  SPEECH_REQUEST_FAILED: {
    en: 'Speech recognition failed. Check the model, API key and connection.',
    'zh-CN': '语音识别失败，请检查模型、API Key 和连接。',
  },
  SPEECH_RESPONSE_INVALID: {
    en: 'The speech service returned an invalid result.',
    'zh-CN': '语音服务返回了无效结果。',
  },
  SPEECH_TIMEOUT: { en: 'Speech recognition timed out. Try again.', 'zh-CN': '语音识别超时，请重试。' },
  SPEECH_CANCELLED: { en: 'Speech recognition was cancelled.', 'zh-CN': '语音识别已取消。' },
};

/**
 * Keeps binary parsing local to this module and aborts upstream work on client disconnect.
 */
export function registerSpeechController(server: FastifyInstance, service: SpeechService) {
  server.addContentTypeParser(
    /^audio\//,
    { parseAs: 'buffer', bodyLimit: speechMaxAudioBytes },
    (_request, body, done) => done(null, body)
  );
  server.get('/settings/speech', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return project(() => service.get());
  });
  server.put('/settings/speech', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = speechSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApplicationError('SPEECH_INVALID', 'Invalid speech settings.', { statusCode: 400 });
    }
    return project(() => service.update(parsed.data));
  });
  server.post('/speech/transcriptions', { bodyLimit: speechMaxAudioBytes }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!Buffer.isBuffer(request.body)) {
      throw new ApplicationError('SPEECH_AUDIO_INVALID', 'Invalid audio.', { statusCode: 400 });
    }
    const controller = new AbortController();
    const abort = () => {
      if (!reply.raw.writableEnded) {
        controller.abort();
      }
    };
    reply.raw.on('close', abort);
    try {
      return await project(() =>
        service.transcribe(request.body as Buffer, request.headers['content-type'] ?? '', controller.signal)
      );
    } finally {
      reply.raw.off('close', abort);
    }
  });
}

/**
 * Maps domain failures without returning upstream or filesystem diagnostics containing secrets.
 */
async function project<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = error instanceof SpeechError ? error.code : 'SPEECH_IO';
    const statuses: Record<string, number> = {
      SPEECH_INVALID: 400,
      SPEECH_KEY_REQUIRED: 400,
      SPEECH_AUDIO_TOO_LARGE: 413,
      SPEECH_CONFLICT: 409,
      SPEECH_DISABLED: 409,
      SPEECH_AUDIO_INVALID: 400,
      SPEECH_BUSY: 429,
      SPEECH_CANCELLED: 409,
      SPEECH_TIMEOUT: 504,
      SPEECH_IO: 500,
    };
    throw new ApplicationError(code, speechErrorMessages[code as keyof typeof speechErrorMessages].en, {
      statusCode: statuses[code] ?? 502,
    });
  }
}
