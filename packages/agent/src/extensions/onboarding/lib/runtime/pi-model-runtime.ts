/**
 * @author Codex
 * @description 将 Pi ModelRuntime 公开 API 适配为 Onboarding Runtime 契约
 */
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AgentModelRuntime, AuthInteraction } from '../../definitions/port.js';
import type { ModelAuthStatus, ModelInfo, ModelProviderInfo } from '../../definitions/types.js';

/**
 * @description Pi 模型运行时适配器。
 */
export class PiModelRuntime implements AgentModelRuntime {
  private runtime?: ModelRuntime;
  /**
   * @description 创建适配器。
   * @param authPath 凭证路径。
   * @param modelsPath 模型配置路径。
   */
  public constructor(
    private readonly authPath: string,
    private readonly modelsPath: string
  ) {}
  /**
   * @description 获取或创建 Runtime。
   * @returns Runtime。
   */
  private async getRuntime(): Promise<ModelRuntime> {
    this.runtime ??= await ModelRuntime.create({
      authPath: this.authPath,
      modelsPath: this.modelsPath,
    });
    return this.runtime;
  }
  /**
   * @description 获取 Provider。
   * @returns Provider 列表。
   */
  public async getProviders(): Promise<ModelProviderInfo[]> {
    const runtime = await this.getRuntime();
    return runtime.getProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      authenticated: runtime.getProviderAuthStatus(provider.id).configured,
      authTypes: [provider.auth.apiKey && 'api_key', provider.auth.oauth && 'oauth'].filter(Boolean) as (
        'api_key' | 'oauth'
      )[],
    }));
  }
  /**
   * @description 获取已配置凭证下可用模型。
   * @returns 模型列表。
   */
  public async getAvailableModels(): Promise<ModelInfo[]> {
    return (await (await this.getRuntime()).getAvailable()).map((model) => ({
      providerId: model.provider,
      modelId: model.id,
      name: model.name,
      reasoning: model.reasoning,
      vision: model.input.includes('image'),
    }));
  }
  /**
   * @description 查询认证状态。
   * @param providerId Provider ID。
   * @returns 状态。
   */
  public async getAuthStatus(providerId: string): Promise<ModelAuthStatus> {
    const status = (await this.getRuntime()).getProviderAuthStatus(providerId);
    return status.configured ? 'authenticated' : 'unauthenticated';
  }
  /**
   * @description 执行 Pi 原生认证。
   * @param providerId Provider ID。
   * @param authType 认证类型。
   * @param interaction UI 交互。
   * @param signal 取消信号。
   */
  public async login(
    providerId: string,
    authType: 'api_key' | 'oauth',
    interaction: AuthInteraction,
    signal?: AbortSignal
  ): Promise<void> {
    await (
      await this.getRuntime()
    ).login(providerId, authType, {
      ...(signal ? { signal } : {}),
      prompt: (prompt) => interaction.prompt(prompt),
      notify: (event) => interaction.notify(event),
    });
  }
  /**
   * @description 刷新 Runtime 快照。
   * @param signal 取消信号。
   */
  public async refresh(signal?: AbortSignal): Promise<void> {
    this.runtime = await ModelRuntime.create({
      authPath: this.authPath,
      modelsPath: this.modelsPath,
      ...(signal ? { signal } : {}),
    });
  }
  /**
   * @description 查找模型。
   * @param providerId Provider ID。
   * @param modelId 模型 ID。
   * @returns 模型或空值。
   */
  public async findModel(providerId: string, modelId: string): Promise<ModelInfo | undefined> {
    const model = (await this.getRuntime()).getModel(providerId, modelId);
    return model
      ? {
          providerId,
          modelId,
          name: model.name,
          reasoning: model.reasoning,
          vision: model.input.includes('image'),
        }
      : undefined;
  }
}
