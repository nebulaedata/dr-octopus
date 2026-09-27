/**
 * @author Codex
 * @description Updates custom model capabilities and token limits through the Server-owned Pi settings boundary.
 */
import { request } from '@/utils/request';
import type { ModelProviderDetailDto, UpdateModelConfigurationBody } from '@octopus/shared/protocol';

/**
 * Saves configuration for one provider-scoped model.
 */
export function updateModelConfiguration(
  providerKey: string,
  modelKey: string,
  data: UpdateModelConfigurationBody
) {
  return request<ModelProviderDetailDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/models/${encodeURIComponent(modelKey)}/configuration`,
    method: 'PUT',
    data,
  });
}
