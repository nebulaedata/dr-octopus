/**
 * @author Codex
 * @description 编排 Onboarding 状态检查以及本地与 Native 模型配置流程
 */
import { OnboardingError } from '../lib/errors.js';
import { requireLocalProvider } from '../lib/providers/local.js';
import {
  validateBaseUrl,
  validateLocalSetup,
  validateNativeSetup,
} from '../validators/onboarding-validator.js';
import type {
  AgentModelRuntime,
  AuthInteraction,
  LocalRuntimeProvider,
  ModelConfigRepository,
  SettingsRepository,
} from '../definitions/port.js';
import type {
  CompleteLocalSetupInput,
  CompleteNativeSetupInput,
  DetectLocalRuntimeInput,
  LocalRuntimeInfo,
  ModelInfo,
  ModelProviderInfo,
  NativeAuthResult,
  OnboardingStatus,
  StartNativeAuthInput,
} from '../definitions/types.js';

/**
 * @description Onboarding 公共用例实现。
 */
export class OnboardingService {
  /**
   * @description 创建服务并注入全部基础设施端口。
   */
  public constructor(
    private readonly modelConfig: ModelConfigRepository,
    private readonly settings: SettingsRepository,
    private readonly runtime: AgentModelRuntime,
    private readonly localProviders: LocalRuntimeProvider[]
  ) {}

  /**
   * @description 计算持久化配置的实时可用状态。
   * @returns 当前状态。
   */
  public async getStatus(): Promise<OnboardingStatus> {
    const settingsExist = await this.settings.exists();
    const configuredModel = await this.settings.getDefaultModel();
    if (!configuredModel.providerId || !configuredModel.modelId) {
      return {
        ready: false,
        phase: 'setup_required',
        reason: settingsExist ? 'NO_MODEL' : 'FIRST_RUN',
      };
    }

    await this.runtime.refresh();
    if (!(await this.runtime.findModel(configuredModel.providerId, configuredModel.modelId))) {
      return {
        ready: false,
        phase: 'error',
        providerId: configuredModel.providerId,
        modelId: configuredModel.modelId,
        reason: 'MODEL_REMOVED',
      };
    }

    if ((await this.runtime.getAuthStatus(configuredModel.providerId)) !== 'authenticated') {
      return {
        ready: false,
        phase: 'error',
        providerId: configuredModel.providerId,
        modelId: configuredModel.modelId,
        reason: 'AUTH_MISSING',
      };
    }

    return {
      ready: true,
      phase: 'ready',
      providerId: configuredModel.providerId,
      modelId: configuredModel.modelId,
    };
  }

  /**
   * @description 获取本地 Runtime 清单。
   * @returns Runtime 信息。
   */
  public getLocalRuntimes(): LocalRuntimeInfo[] {
    return this.localProviders.map((provider) => provider.info);
  }
  /**
   * @description 探测本地 Runtime。
   * @param input 探测输入。
   * @returns 探测结果。
   */
  public async detectLocalRuntime(input: DetectLocalRuntimeInput) {
    return requireLocalProvider(this.localProviders, input.runtime).detect(
      validateBaseUrl(input.baseUrl),
      input.signal
    );
  }
  /**
   * @description 完成本地模型配置并验证落盘结果。
   * @param input 配置输入。
   * @returns Ready 状态。
   */
  public async completeLocalSetup(input: CompleteLocalSetupInput): Promise<OnboardingStatus> {
    validateLocalSetup(input);
    const baseUrl = validateBaseUrl(input.baseUrl);
    const detected = await this.detectLocalRuntime({ ...input, baseUrl });
    if (!detected.reachable) {
      throw new OnboardingError(
        'LOCAL_RUNTIME_OFFLINE',
        'The local runtime is not reachable. Start it and try again.'
      );
    }
    if (!detected.models.some((model) => model.id === input.modelId)) {
      throw new OnboardingError('MODEL_NOT_FOUND', `Model ${input.modelId} is not exposed by the runtime.`);
    }
    const providerId = `octopus-${input.runtime}`;
    await this.modelConfig.upsertLocalProvider(providerId, baseUrl, input.modelId);
    await this.runtime.refresh(input.signal);
    if (!(await this.runtime.findModel(providerId, input.modelId))) {
      throw new OnboardingError('MODEL_NOT_FOUND', 'The saved model could not be loaded by Pi.');
    }
    await this.settings.setDefaultModel(providerId, input.modelId);
    return {
      ready: true,
      phase: 'ready',
      providerId,
      modelId: input.modelId,
    };
  }
  /**
   * @description 获取 Pi Native Provider。
   * @returns Provider 信息。
   */
  public async getNativeProviders(): Promise<ModelProviderInfo[]> {
    return this.runtime.getProviders();
  }
  /**
   * @description 获取当前可用 Native 模型。
   * @returns 模型信息。
   */
  public async getAvailableModels(): Promise<ModelInfo[]> {
    return this.runtime.getAvailableModels();
  }
  /**
   * @description 发起 Native 认证。
   * @param input 认证输入。
   * @param interaction 交互适配。
   * @returns 认证结果。
   */
  public async startNativeAuth(
    input: StartNativeAuthInput,
    interaction: AuthInteraction
  ): Promise<NativeAuthResult> {
    const providers = await this.runtime.getProviders();
    const provider = providers.find((candidate) => candidate.id === input.providerId);
    if (!provider) {
      throw new OnboardingError('PROVIDER_NOT_FOUND', 'Unknown Pi provider.');
    }
    const authType = input.authType ?? (provider.authTypes?.includes('oauth') ? 'oauth' : 'api_key');
    await this.runtime.login(input.providerId, authType, interaction, input.signal);
    return {
      providerId: input.providerId,
      authenticated: (await this.runtime.getAuthStatus(input.providerId)) === 'authenticated',
    };
  }
  /**
   * @description 完成 Native 默认模型配置。
   * @param input 配置输入。
   * @returns Ready 状态。
   */
  public async completeNativeSetup(input: CompleteNativeSetupInput): Promise<OnboardingStatus> {
    validateNativeSetup(input);
    if ((await this.runtime.getAuthStatus(input.providerId)) !== 'authenticated') {
      throw new OnboardingError('AUTH_MISSING', 'Authenticate this provider before selecting a model.');
    }
    await this.runtime.refresh();
    if (!(await this.runtime.findModel(input.providerId, input.modelId))) {
      throw new OnboardingError('MODEL_NOT_FOUND', 'The selected model is not available.');
    }
    await this.settings.setDefaultModel(input.providerId, input.modelId);
    return {
      ready: true,
      phase: 'ready',
      providerId: input.providerId,
      modelId: input.modelId,
    };
  }
}
