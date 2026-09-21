/**
 * @author Codex
 * @description 注册 Onboarding 状态与本地运行时只读模型工具
 */
import { Type } from 'typebox';
import { OnboardingError } from '../lib/errors.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { OnboardingService } from '../services/onboarding-service.js';

/**
 * @description 注册 Onboarding 只读模型工具。
 * @param pi 当前 Pi Extension API。
 * @param service Onboarding 应用服务。
 */
export function registerOnboardingTools(pi: ExtensionAPI, service: OnboardingService): void {
  pi.registerTool({
    name: 'octopus_model_status',
    label: 'Octopus Model Status',
    description:
      'Read the current Octopus onboarding and default model readiness status. Throws when the model is not ready.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      const status = await service.getStatus();
      if (!status.ready) {
        throw new OnboardingError(
          status.reason ?? 'MODEL_NOT_READY',
          `Model is not ready: ${status.reason ?? status.phase}. Configure the default model and authentication.`
        );
      }
      return {
        content: [
          {
            type: 'text',
            text: `Ready: ${status.providerId}/${status.modelId}`,
          },
        ],
        details: { status },
      };
    },
  });
  pi.registerTool({
    name: 'octopus_check_local_runtime',
    label: 'Check Local Model Runtime',
    description:
      'Read-only check of an Ollama, vLLM, or LM Studio endpoint and its exposed models. Throws when the runtime is unreachable.',
    parameters: Type.Object(
      {
        runtime: Type.Union([Type.Literal('ollama'), Type.Literal('vllm'), Type.Literal('lmstudio')]),
        baseUrl: Type.String(),
      },
      { additionalProperties: false }
    ),
    async execute(_id, params, signal) {
      const result = await service.detectLocalRuntime(signal ? { ...params, signal } : params);
      if (!result.reachable) {
        throw new OnboardingError(
          'LOCAL_RUNTIME_OFFLINE',
          'The local runtime is not reachable. Start it and try again.'
        );
      }
      return {
        content: [
          {
            type: 'text',
            text: `Reachable; models: ${result.models.map((model) => model.id).join(', ') || '(none)'}`,
          },
        ],
        details: result,
      };
    },
  });
}
