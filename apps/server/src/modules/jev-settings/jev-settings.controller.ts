/**
 * @author Codex
 * @description Validates Jev settings requests and localizes safe provider errors.
 * - GET /api/settings/jev
 * - GET /api/settings/jev/models
 * - PUT /api/settings/jev
 * - PATCH /api/settings/jev/credential
 * - POST /api/settings/jev/probe
 */
import { JevError } from '@octopus/agent';
import { jevCredentialUpdateSchema, jevSettingsUpdateSchema } from '@octopus/shared/protocol';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { registerErrorMessages } from '../../infrastructure/i18n/error-catalog.js';
import type { FastifyInstance } from 'fastify';
import type { JevSettingsService } from './jev-settings.service.js';

export const jevErrorMessages = {
  JEV_CONFIG_INVALID: { en: 'Invalid Jev settings.', 'zh-CN': 'Jev 配置无效。' },
  JEV_CONFIG_IO: { en: 'Could not read or save Jev settings.', 'zh-CN': '无法读取或保存 Jev 配置。' },
  JEV_CONFIG_CONFLICT: {
    en: 'Jev settings changed. Reopen settings before saving.',
    'zh-CN': 'Jev 配置已变更，请重新打开设置后保存。',
  },
  JEV_CONFIG_BUSY: {
    en: 'Jev settings are being saved. Try again.',
    'zh-CN': 'Jev 配置正在保存，请稍后重试。',
  },
  JEV_KEY_REQUIRED: { en: 'Configure a TypeSafe API key first.', 'zh-CN': '请先配置 TypeSafe API Key。' },
  JEV_REQUEST_FAILED: {
    en: 'Jev request failed. Check the key and connection.',
    'zh-CN': 'Jev 请求失败，请检查密钥和连接。',
  },
  JEV_TIMEOUT: { en: 'Jev request timed out.', 'zh-CN': 'Jev 请求超时。' },
  JEV_RESPONSE_INVALID: {
    en: 'Jev returned an invalid evaluation.',
    'zh-CN': 'Jev 返回了无效的判断结果。',
  },
};

/**
 * Publish safe bilingual errors without exposing credential-bearing request or response bodies.
 */
export function registerJevErrors() {
  registerErrorMessages('jev-settings', jevErrorMessages);
}

/**
 * Retain existing API access controls and disable caching of credential-state metadata.
 */
export function registerJevController(server: FastifyInstance, service: JevSettingsService) {
  server.get('/settings/jev', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return projectJevResult(() => service.get());
  });
  server.get('/settings/jev/models', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return projectJevResult(() => service.models());
  });
  server.put('/settings/jev', async (request, reply) => {
    const parsed = jevSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApplicationError('JEV_CONFIG_INVALID', 'Invalid Jev settings.', { statusCode: 400 });
    }
    reply.header('Cache-Control', 'no-store');
    return projectJevResult(() => service.update(parsed.data));
  });
  server.post('/settings/jev/probe', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return projectJevResult(() => service.probe());
  });
  server.patch('/settings/jev/credential', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = jevCredentialUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApplicationError('JEV_CONFIG_INVALID', 'Invalid Jev settings.', { statusCode: 400 });
    }
    return projectJevResult(() => service.updateCredential(parsed.data));
  });
}

/**
 * Translate domain failures into HTTP status codes without leaking provider or filesystem details.
 */
async function projectJevResult<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = error instanceof JevError ? error.code : 'JEV_CONFIG_IO';
    let statusCode = 502;
    if (code === 'JEV_CONFIG_INVALID' || code === 'JEV_KEY_REQUIRED') {
      statusCode = 400;
    }
    if (code === 'JEV_CONFIG_CONFLICT' || code === 'JEV_CONFIG_BUSY') {
      statusCode = 409;
    }
    throw new ApplicationError(code, 'Jev operation failed.', { statusCode });
  }
}
