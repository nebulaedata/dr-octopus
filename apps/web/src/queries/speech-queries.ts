/**
 * @author Codex
 * @description Synchronizes speech settings between the settings page and all Composer instances.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSpeechSettings, saveSpeechSettings } from '@/api/speech';
import { queryKeys } from './core/query-keys';

export const speechSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.speech,
  queryFn: ({ signal }) => getSpeechSettings(signal),
});
/**
 * Reads the server-authoritative speech enablement and model.
 */
export function useSpeechSettings() {
  return useQuery(speechSettingsQueryOptions);
}
/**
 * Publishes saved configuration immediately to active Composers.
 */
export function useSaveSpeechSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveSpeechSettings,
    onSuccess: async (settings) => {
      client.setQueryData(queryKeys.speech, settings);
      await client.invalidateQueries({ queryKey: queryKeys.speech });
    },
  });
}
