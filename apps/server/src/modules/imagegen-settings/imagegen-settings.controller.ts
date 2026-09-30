/**
 * @author Codex
 * @description Exposes redacted independent image-service configuration through the Agent SDK.
 * GET /api/settings/imagegen
 * PUT /api/settings/imagegen
 */
import { readImagegenSettings, updateImagegenSettings, ImagegenSettingsError } from '@octopus/agent';
import { imagegenSettingsUpdateSchema } from '@octopus/shared/protocol';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import type { FastifyInstance } from 'fastify';

export const imagegenErrorMessages = {
  IMAGEGEN_INVALID: {
    en: 'Check the image service URL and model. Only OpenAI GPT Image and Qwen Image are supported.',
    'zh-CN': '请检查生图服务地址和模型，仅支持 OpenAI GPT Image 和 Qwen Image。',
  },
  IMAGEGEN_CONFLICT: {
    en: 'Image settings changed. Reload before saving.',
    'zh-CN': '生图配置已变更，请重新加载后保存。',
  },
  IMAGEGEN_KEY_REQUIRED: {
    en: 'Add an API key before enabling this image service.',
    'zh-CN': '启用生图服务前，请先配置 API Key。',
  },
  IMAGEGEN_SETTINGS_IO: { en: 'Could not read or save image settings.', 'zh-CN': '无法读取或保存生图配置。' },
};

/**
 * Validates request bodies and delegates complete atomic settings operations to the owning SDK.
 */
export function registerImagegenSettingsController(server: FastifyInstance, agentDir: string): void {
  server.get('/settings/imagegen', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return project(() => readImagegenSettings(agentDir));
  });
  server.put('/settings/imagegen', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = imagegenSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApplicationError('IMAGEGEN_INVALID', 'Invalid image settings.', { statusCode: 400 });
    }
    return project(() => updateImagegenSettings(agentDir, parsed.data));
  });
}

/**
 * Keeps credential-bearing filesystem and validation diagnostics out of HTTP responses.
 */
async function project<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ImagegenSettingsError) {
      throw new ApplicationError(error.code, error.message, {
        statusCode: error.code === 'IMAGEGEN_CONFLICT' ? 409 : 422,
      });
    }
    throw new ApplicationError('IMAGEGEN_SETTINGS_IO', 'Could not read or save image settings.', {
      statusCode: 500,
    });
  }
}
