/**
 * @author Codex
 * @description Owns local runtime queries and synchronizes provider caches after configuration writes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  configureLocalProvider,
  createLocalProvider,
  detectLocalProvider,
  getLocalRuntimes,
} from '@/api/local-providers';
import { queryKeys } from '@/queries/core/query-keys';
import type { ConfigureLocalProviderBody, ModelProviderDetailDto } from '@octopus/shared/protocol';

/**
 * Loads supported runtimes from onboarding through the Server.
 */
export function useLocalRuntimes() {
  return useQuery({
    queryKey: ['settings', 'local-runtimes'],
    queryFn: ({ signal }) => getLocalRuntimes(signal),
  });
}
/**
 * Owns creation and updates while keeping provider and default-model candidates coherent.
 */
export function useLocalProviderMutations(providerKey = '') {
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
    create: useMutation({ mutationFn: createLocalProvider, onSuccess: synchronize }),
    detect: useMutation({ mutationFn: (baseUrl: string) => detectLocalProvider(providerKey, baseUrl) }),
    configure: useMutation({
      mutationFn: (input: ConfigureLocalProviderBody) => configureLocalProvider(providerKey, input),
      onSuccess: synchronize,
    }),
  };
}
