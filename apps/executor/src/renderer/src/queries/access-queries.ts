/**
 * @author Codex
 * @description Defines the safe Host authorization query without retaining connection credentials.
 */
import { queryOptions } from '@tanstack/react-query';
import { readAccess, readClientConfiguration } from '@/api/executor';
import type { ClientConfigurationInput } from '../../../contracts/client-configuration';

export const accessQuery = queryOptions({
  queryKey: ['executor', 'access'],
  queryFn: readAccess,
  networkMode: 'always',
  retry: false,
  staleTime: 0,
});

/**
 * Caches only credential-free configuration previews by authorization and transport.
 */
export function clientConfigurationQuery(input: ClientConfigurationInput) {
  return queryOptions({
    queryKey: ['executor', 'client-configuration', input.clientId, input.transport],
    queryFn: () => readClientConfiguration(input),
    networkMode: 'always',
    retry: false,
    staleTime: 0,
  });
}
