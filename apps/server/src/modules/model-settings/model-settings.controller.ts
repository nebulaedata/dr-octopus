/**
 * @author Codex
 * @description Registers Settings model, default-model, and Provider authentication endpoints.
 * - GET /api/settings/model-providers
 * - PUT /api/settings/model-providers/:providerKey/models/:modelKey/capabilities
 * - GET /api/settings/model-providers/:providerKey
 * - DELETE /api/settings/model-providers/:providerKey
 * - GET /api/settings/default-model
 * - GET /api/settings/default-model/candidates
 * - PUT /api/settings/default-model
 * - DELETE /api/settings/model-providers/:providerKey/auth
 * - POST /api/settings/model-providers/:providerKey/auth-sessions
 * - GET /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId
 * - POST /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId/answers
 * - DELETE /api/settings/model-providers/:providerKey/auth-sessions/:authSessionId
 */
import {
  ConfigureCustomProviderBodySchema,
  CreateCustomProviderBodySchema,
  DetectCustomProviderBodySchema,
  UpdateDefaultModelBodySchema,
  UpdateModelCapabilitiesBodySchema,
} from '@octopus/shared/protocol';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { registerErrorMessages } from '../../infrastructure/i18n/error-catalog.js';
import {
  MutationIdempotencyLedger,
  mutationFingerprint,
} from '../../infrastructure/idempotency/mutation-ledger.js';
import type { UpdateDefaultModelBody } from '@octopus/shared/protocol';
import type { FastifyInstance } from 'fastify';
import type { ErrorMessageCatalog } from '../../infrastructure/i18n/error-catalog.js';
import type { SettingsService } from './model-settings.service.js';

interface ProviderParams {
  providerKey: string;
}

/**
 * Registers Settings routes against one application service.
 *
 * @param server Fastify application receiving the routes.
 * @param service Settings application use cases.
 */
export function registerSettingsController(server: FastifyInstance, service: SettingsService): void {
  registerCustomProviderController(server, service);
  server.get('/settings/model-providers', () => service.listProviders());

  server.get<{ Params: ProviderParams }>('/settings/model-providers/:providerKey', async (request, reply) => {
    const provider = await service.getProvider(request.params.providerKey);
    if (provider === undefined) {
      return reply.status(404).send({
        code: 'MODEL_PROVIDER_NOT_FOUND',
        message: 'The requested model provider does not exist.',
        requestId: request.id,
        retryable: false,
      });
    }
    return provider;
  });
  server.delete<{ Params: ProviderParams }>('/settings/model-providers/:providerKey', (request) =>
    service.deleteCustomProvider(request.params.providerKey)
  );

  server.put<{ Params: ProviderParams & { modelKey: string } }>(
    '/settings/model-providers/:providerKey/models/:modelKey/capabilities',
    (request) => {
      const body = UpdateModelCapabilitiesBodySchema.safeParse(request.body);
      if (!body.success) {
        throw invalidSettingsRequest('The model capabilities are malformed.');
      }
      return service.updateModelCapabilities(request.params.providerKey, request.params.modelKey, body.data);
    }
  );

  server.get('/settings/default-model', () => service.getDefaultModel());
  server.get('/settings/default-model/candidates', () => service.listDefaultModelCandidates());
  server.put<{ Body: UpdateDefaultModelBody }>('/settings/default-model', (request, reply) => {
    const body = UpdateDefaultModelBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'INVALID_SETTINGS_REQUEST',
        message: 'The default-model selection is malformed.',
        requestId: request.id,
        retryable: false,
      });
    }
    return service.setDefaultModel(body.data.providerKey, body.data.modelKey);
  });
}

/**
 * Creates a stable Settings request validation error.
 */
function invalidSettingsRequest(message: string): ApplicationError {
  return new ApplicationError('INVALID_SETTINGS_REQUEST', message, { statusCode: 400 });
}

/**
 * Validates bodies and ensures retried creation requests cannot duplicate providers.
 */
export function registerCustomProviderController(server: FastifyInstance, service: SettingsService): void {
  const ledger = new MutationIdempotencyLedger();
  server.get('/settings/local-runtimes', () => service.getCustomProviderTypes());
  server.post('/settings/local-providers', async (request, reply) => {
    const body = CreateCustomProviderBodySchema.safeParse(request.body);
    const key = request.headers['idempotency-key'];
    if (
      !body.success ||
      typeof key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
    ) {
      throw invalidRequest();
    }
    const result = await ledger.execute(
      {
        scope: 'custom-providers',
        key,
        type: 'create-custom-provider',
        fingerprint: mutationFingerprint(body.data),
      },
      () => service.createCustomProvider(body.data)
    );
    return reply.status(201).send(result);
  });
  server.post<{ Params: { providerKey: string } }>(
    '/settings/model-providers/:providerKey/local/detect',
    (request) => {
      const body = DetectCustomProviderBodySchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      return service.detectCustomProvider(request.params.providerKey, body.data.baseUrl, body.data.apiKey);
    }
  );
  server.put<{ Params: { providerKey: string } }>(
    '/settings/model-providers/:providerKey/local',
    (request) => {
      const body = ConfigureCustomProviderBodySchema.safeParse(request.body);
      if (!body.success) {
        throw invalidRequest();
      }
      return service.configureCustomProvider(request.params.providerKey, body.data);
    }
  );
}
/**
 * Returns a stable validation failure without echoing request data.
 */
function invalidRequest() {
  return new ApplicationError('INVALID_SETTINGS_REQUEST', '模型服务配置无效，请检查名称、服务地址和模型。', {
    statusCode: 400,
  });
}

/**
 * Settings-domain message variants keyed by stable error code.
 */
export const settingsErrorMessages: ErrorMessageCatalog = {
  MODEL_PROVIDER_CAPABILITY_UNSUPPORTED: {
    en: 'This operation is not supported by the selected provider or model.',
    'zh-CN': '所选提供商或模型不支持此操作。',
  },
  INVALID_PERMISSION_CONFIG: {
    en: 'The permission configuration request is invalid.',
    'zh-CN': '无效的权限配置请求。',
  },
  INVALID_PERMISSION_SCOPE: {
    en: 'The permission configuration scope is invalid.',
    'zh-CN': '无效的权限配置范围。',
  },
  LOCAL_MODEL_NOT_FOUND: {
    en: 'The selected model is no longer available; retrieve the model list again.',
    'zh-CN': '所选模型已不可用，请重新获取模型列表。',
  },
  MODEL_DISCOVERY_AUTH_FAILED: {
    en: 'The API Key is invalid or cannot list models for this provider.',
    'zh-CN': 'API Key 无效，或没有获取该提供商模型列表的权限。',
  },
  MODEL_DISCOVERY_FAILED: {
    en: 'The provider rejected the model-list request.',
    'zh-CN': '提供商拒绝了获取模型列表的请求。',
  },
  MODEL_DISCOVERY_INVALID_RESPONSE: {
    en: 'The provider returned an invalid model list.',
    'zh-CN': '提供商返回的模型列表格式无效。',
  },
  LOCAL_RUNTIME_OFFLINE: {
    en: 'Cannot connect to the model service. Check its address and availability.',
    'zh-CN': '无法连接模型服务，请检查服务地址和运行状态。',
  },
  LOCAL_PROVIDER_NOT_FOUND: {
    en: 'This provider is not a configurable custom model service.',
    'zh-CN': '该提供商不是可配置的自定义模型服务。',
  },
  MODEL_PROVIDER_DEFAULT_IN_USE: {
    en: 'Choose another default model before deleting this provider.',
    'zh-CN': '请先选择其他默认模型，再删除此模型服务。',
  },
  MODEL_PROVIDER_API_KEY_REQUIRED: {
    en: 'An API Key is required for this remote model service.',
    'zh-CN': '远程模型服务需要填写 API Key。',
  },
  PERMISSION_CONFIG_BUSY: {
    en: 'The permission configuration is being saved; try again later.',
    'zh-CN': '权限配置正在保存，请稍后重试。',
  },
  PERMISSION_CONFIG_INVALID: [
    { en: 'The permission configuration is invalid.', 'zh-CN': '权限配置无效。' },
    {
      match: '权限配置文件不可读取',
      en: 'The permission configuration file is unreadable.',
      'zh-CN': '权限配置文件不可读取',
    },
    {
      match: '权限配置格式无效',
      en: 'The permission configuration format is invalid.',
      'zh-CN': '权限配置格式无效',
    },
    {
      match: '权限配置目录不能是符号链接',
      en: 'The permission configuration directory cannot be a symbolic link.',
      'zh-CN': '权限配置目录不能是符号链接',
    },
    {
      match: '请先修复全局权限配置',
      en: 'Fix the global permission configuration first.',
      'zh-CN': '请先修复全局权限配置',
    },
    {
      match: '权限配置不能超过 1 MiB',
      en: 'The permission configuration cannot exceed 1 MiB.',
      'zh-CN': '权限配置不能超过 1 MiB',
    },
  ],
};

/**
 * Merges the settings-domain catalog into the shared error-message registry at Server boot.
 */
export function registerSettingsErrorMessages(): void {
  registerErrorMessages('settings', settingsErrorMessages);
}
