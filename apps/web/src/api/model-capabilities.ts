/**
 * @author Codex
 * @description Updates custom model capabilities through the Server-owned Pi settings boundary.
 */
import { request } from '@/utils/request';
import type { ModelProviderDetailDto, UpdateModelCapabilitiesBody } from '@octopus/shared/protocol';

/**
 * Saves capability metadata for one provider-scoped model.
 */
export function updateModelCapabilities(
  providerKey: string,
  modelKey: string,
  data: UpdateModelCapabilitiesBody
) {
  return request<ModelProviderDetailDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/models/${encodeURIComponent(modelKey)}/capabilities`,
    method: 'PUT',
    data,
  });
}
