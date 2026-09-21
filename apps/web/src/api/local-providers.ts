/**
 * @author Codex
 * @description Provides typed HTTP access to local provider drafts and onboarding discovery.
 */
import { request } from '@/utils/request';
import type {
  ConfigureLocalProviderBody,
  CreateLocalProviderBody,
  LocalModelDetectionDto,
  LocalRuntimeDto,
  ModelProviderDetailDto,
} from '@octopus/shared/protocol';

/**
 * Reads the Server-projected runtime names and defaults.
 */
export function getLocalRuntimes(signal?: AbortSignal) {
  return request<LocalRuntimeDto[]>({ url: '/settings/local-runtimes', method: 'GET', signal });
}
/**
 * Saves a draft under a stable request identity.
 */
export function createLocalProvider(input: CreateLocalProviderBody) {
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
export function detectLocalProvider(providerKey: string, baseUrl: string) {
  return request<LocalModelDetectionDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/local/detect`,
    method: 'POST',
    data: { baseUrl },
  });
}
/**
 * Persists an endpoint and exposed model without changing the default model.
 */
export function configureLocalProvider(providerKey: string, input: ConfigureLocalProviderBody) {
  return request<ModelProviderDetailDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/local`,
    method: 'PUT',
    data: input,
  });
}
