/**
 * @author Codex
 * @description 通过标准 HTTP 接口探测 Ollama、vLLM 与 LM Studio 模型
 */
import { OnboardingError } from '../errors.js';
import { validateBaseUrl } from '../../validators/onboarding-validator.js';
import type {
  LocalRuntimeDetectionResult,
  LocalRuntimeInfo,
  LocalRuntimeType,
} from '../../definitions/types.js';
import type { LocalRuntimeProvider } from '../../definitions/port.js';

const INFOS: Record<LocalRuntimeType, LocalRuntimeInfo> = {
  ollama: { id: 'ollama', name: 'Ollama', defaultBaseUrl: 'http://127.0.0.1:11434' },
  vllm: { id: 'vllm', name: 'vLLM', defaultBaseUrl: 'http://127.0.0.1:8000/v1' },
  lmstudio: { id: 'lmstudio', name: 'LM Studio', defaultBaseUrl: 'http://127.0.0.1:1234/v1' },
};

/**
 * @description 本地 Provider HTTP 实现。
 */
export class HttpLocalRuntimeProvider implements LocalRuntimeProvider {
  /**
   * @description 创建指定类型的本地 Runtime Provider。
   * @param runtime Runtime 类型。
   */
  public constructor(public readonly info: LocalRuntimeInfo) {}

  /**
   * @description 探测服务并规范化其模型列表。
   * @param baseUrl 服务根 URL。
   * @param signal 取消信号。
   * @returns 可达性与模型列表。
   */
  public async detect(baseUrl: string, signal?: AbortSignal): Promise<LocalRuntimeDetectionResult> {
    const root = validateBaseUrl(baseUrl);
    const endpoint =
      this.info.id === 'ollama' ? `${root}/api/tags` : `${root.replace(/\/v1$/, '')}/v1/models`;
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) {
        return { reachable: false, models: [] };
      }
      const body = (await response.json()) as {
        models?: { name?: string; model?: string }[];
        data?: { id?: string; name?: string }[];
      };
      const raw =
        this.info.id === 'ollama'
          ? (body.models ?? []).map((model) => ({
              id: model.model ?? model.name ?? '',
              ...(model.name ? { name: model.name } : {}),
            }))
          : (body.data ?? []).map((model) => ({
              id: model.id ?? '',
              ...(model.name ? { name: model.name } : {}),
            }));
      return { reachable: true, models: raw.filter((model) => Boolean(model.id)) };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      return { reachable: false, models: [] };
    }
  }
}

/**
 * @description 创建全部受支持本地 Runtime Provider。
 * @returns Provider 列表。
 */
export function createLocalProviders(): LocalRuntimeProvider[] {
  return Object.values(INFOS).map((info) => new HttpLocalRuntimeProvider(info));
}

/**
 * @description 查找指定 Provider，未找到时抛出稳定错误。
 * @param providers Provider 列表。
 * @param runtime Runtime 类型。
 * @returns 匹配 Provider。
 */
export function requireLocalProvider(
  providers: LocalRuntimeProvider[],
  runtime: LocalRuntimeType
): LocalRuntimeProvider {
  const provider = providers.find((candidate) => candidate.info.id === runtime);
  if (!provider) {
    throw new OnboardingError('INVALID_RUNTIME', `Unsupported local runtime: ${runtime}`);
  }
  return provider;
}
