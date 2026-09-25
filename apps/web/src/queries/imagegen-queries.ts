/**
 * @author Codex
 * @description Owns image model server state and mutation cache synchronization.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getImagegenCandidates, getImagegenSettings, saveImagegenSettings } from '@/api/imagegen';
import { queryKeys } from './core/query-keys';

/**
 * Loads the independent default and candidate list in parallel.
 */
export function useImagegenSettings() {
  const current = useQuery({
    queryKey: queryKeys.imagegen,
    queryFn: ({ signal }) => getImagegenSettings(signal),
  });
  const candidates = useQuery({
    queryKey: queryKeys.imagegenCandidates,
    queryFn: ({ signal }) => getImagegenCandidates(signal),
  });
  return { current, candidates };
}

/**
 * Saves the next-call default and updates dependent settings views.
 */
export function useSaveImagegenSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveImagegenSettings,
    async onSuccess(value) {
      client.setQueryData(queryKeys.imagegen, value);
      await client.invalidateQueries({ queryKey: queryKeys.imagegenCandidates });
    },
  });
}
