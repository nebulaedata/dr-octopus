/**
 * @author Codex
 * @description Keeps Jev settings authoritative without replacing an editor on window focus.
 */
import { queryOptions } from '@tanstack/react-query';
import { getJevSettings, getJevModels } from '@/api/jev';
/**
 * Refresh on entry; concurrent saves are protected by document revision.
 */
export const jevSettingsQuery = () =>
  queryOptions({
    queryKey: ['jev-settings'],
    queryFn: ({ signal }) => getJevSettings(signal),
    refetchOnWindowFocus: false,
  });

/**
 * Reload discovery after environment edits without caching a credential in the query key.
 */
export const jevModelsQuery = (environmentRevision: string) =>
  queryOptions({
    queryKey: ['jev-models', environmentRevision],
    queryFn: ({ signal }) => getJevModels(signal),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
