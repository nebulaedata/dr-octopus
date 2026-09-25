/**
 * @author Codex
 * @description Provides typed HTTP access to user-added providers and local model discovery.
 */
import { request } from '@/utils/request';
import type {
  ConfigureCustomProviderBody,
  CreateCustomProviderBody,
  CustomProviderModelDetectionDto,
  CustomProviderTypeDto,
  DetectCustomProviderBody,
  ModelProviderDetailDto,
} from '@octopus/shared/protocol';

/**
 * Reads the Server-projected runtime names and defaults.
 */
export function getCustomProviderTypes(signal?: AbortSignal) {
  return request<CustomProviderTypeDto[]>({ url: '/settings/local-runtimes', method: 'GET', signal });
}
/**
 * Saves a draft under a stable request identity.
 */
export function createCustomProvider(input: CreateCustomProviderBody) {
  return request<ModelProviderDetailDto>({
    url: '/settings/local-providers',
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}
/**
 * Discovers models from the selected provider's address.
 */
export function detectCustomProvider(providerKey: string, input: DetectCustomProviderBody) {
  return request<CustomProviderModelDetectionDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/local/detect`,
    method: 'POST',
    data: input,
  });
}
/**
 * Persists an endpoint and exposed model without changing the default model.
 */
export function configureCustomProvider(providerKey: string, input: ConfigureCustomProviderBody) {
  return request<ModelProviderDetailDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/local`,
    method: 'PUT',
    data: input,
  });
}

/**
 * Deletes a Settings-created provider after the Server checks default-model ownership.
 */
export function deleteCustomProvider(providerKey: string) {
  return request<{ deleted: true }>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}`,
    method: 'DELETE',
  });
}
