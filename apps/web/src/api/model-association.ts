/**
 * @author Codex
 * @description Reads native Pi association choices and saves relay model corrections.
 */
import { request } from '@/utils/request';
import type {
  ModelProviderDetailDto,
  ModelAssociationCandidate,
  UpdateModelAssociationBody,
} from '@octopus/shared/protocol';
/**
 * Lists transferable native templates for the selected relay protocol.
 */
export function getModelAssociations(providerKey: string, signal?: AbortSignal) {
  return request<{ candidates: ModelAssociationCandidate[] }>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/associations`,
    signal,
  });
}
/**
 * Saves a correction or restores automatic matching.
 */
export function updateModelAssociation(
  providerKey: string,
  modelKey: string,
  data: UpdateModelAssociationBody
) {
  return request<ModelProviderDetailDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/models/${encodeURIComponent(modelKey)}/association`,
    method: 'PUT',
    data,
  });
}
