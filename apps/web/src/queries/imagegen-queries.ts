/**
 * @author Codex
 * @description Owns independent image-service server state and mutation cache synchronization.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getImagegenSettings, saveImagegenSettings } from '@/api/imagegen';
import { queryKeys } from './core/query-keys';
/**
 * Loads the credential-free settings projection.
 */
export function useImagegenSettings() {
  return useQuery({ queryKey: queryKeys.imagegen, queryFn: ({ signal }) => getImagegenSettings(signal) });
}
/**
 * Updates the cache only after a confirmed revision-fenced save.
 */
export function useSaveImagegenSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveImagegenSettings,
    onSuccess: (value) => {
      client.setQueryData(queryKeys.imagegen, value);
    },
  });
}
