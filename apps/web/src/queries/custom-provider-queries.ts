/**
 * @author Codex
 * @description Owns custom provider type queries and synchronizes caches after configuration writes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  configureCustomProvider,
  createCustomProvider,
  detectCustomProvider,
  deleteCustomProvider,
  getCustomProviderTypes,
} from '@/api/custom-providers';
import { queryKeys } from '@/queries/core/query-keys';
import type {
  ConfigureCustomProviderBody,
  DetectCustomProviderBody,
  ModelProviderDetailDto,
} from '@octopus/shared/protocol';

/**
 * Loads supported custom provider types from the Server.
 */
export function useCustomProviderTypes() {
  return useQuery({
    queryKey: ['settings', 'custom-provider-types'],
    queryFn: ({ signal }) => getCustomProviderTypes(signal),
  });
}
/**
 * Owns creation and updates while keeping provider and default-model candidates coherent.
 */
export function useCustomProviderMutations(providerKey = '') {
  const client = useQueryClient();
  /**
   * Publishes saved details before refreshing affected catalog queries.
   */
  async function synchronize(provider: ModelProviderDetailDto) {
    client.setQueryData(queryKeys.modelProvider(provider.providerKey), provider);
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.modelProvidersRoot }),
      client.invalidateQueries({ queryKey: queryKeys.defaultModel }),
    ]);
  }
  return {
    create: useMutation({ mutationFn: createCustomProvider, onSuccess: synchronize }),
    detect: useMutation({
      mutationFn: (input: DetectCustomProviderBody) => detectCustomProvider(providerKey, input),
    }),
    configure: useMutation({
      mutationFn: (input: ConfigureCustomProviderBody) => configureCustomProvider(providerKey, input),
      onSuccess: synchronize,
    }),
    remove: useMutation({
      mutationFn: () => deleteCustomProvider(providerKey),
      onSuccess: async () => {
        client.removeQueries({ queryKey: queryKeys.modelProvider(providerKey) });
        await Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.modelProvidersRoot }),
          client.invalidateQueries({ queryKey: queryKeys.defaultModel }),
        ]);
      },
    }),
  };
}
