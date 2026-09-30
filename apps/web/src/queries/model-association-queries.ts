/**
 * @author Codex
 * @description Loads relay association candidates and refreshes model-selection caches after corrections.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getModelAssociations, updateModelAssociation } from '@/api/model-association';
import { queryKeys } from './core/query-keys';
import type { UpdateModelAssociationBody } from '@octopus/shared/protocol';
/**
 * Loads Pi templates across protocols when the association editor is mounted.
 */
export function useModelAssociations(providerKey: string) {
  return useQuery({
    queryKey: [...queryKeys.modelProvider(providerKey), 'associations'],
    queryFn: ({ signal }) => getModelAssociations(providerKey, signal),
  });
}
/**
 * Saves one correction then synchronizes catalog and current conversation model choices.
 */
export function useUpdateModelAssociation(providerKey: string, modelKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateModelAssociationBody) => updateModelAssociation(providerKey, modelKey, body),
    onSuccess: async (provider) => {
      client.setQueryData(queryKeys.modelProvider(providerKey), provider);
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.modelProvidersRoot }),
        client.invalidateQueries({ queryKey: queryKeys.defaultModel }),
        client.invalidateQueries({ queryKey: ['conversation-models'] }),
        client.invalidateQueries({ queryKey: queryKeys.bootstrapRoot }),
      ]);
    },
  });
}
