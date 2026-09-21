/**
 * @author Codex
 * @description Owns non-secret Provider authentication queries and write-only prompt submission state.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  answerProviderAuthPrompt,
  cancelProviderAuthSession,
  createProviderAuthSession,
  getProviderAuthSession,
  resetProviderAuth,
} from '../api/settings';
import { queryKeys } from './query-keys';
import type { ModelProviderAuthMethod, ProviderAuthSessionDto } from '@octopus/shared/protocol';

const TERMINAL_STATUSES = new Set<ProviderAuthSessionDto['status']>([
  'completed',
  'failed',
  'committed_but_unsynced',
  'cancelled',
  'expired',
]);

/**
 * Polls one active authentication session without persisting it outside Query memory.
 *
 * @param providerKey Opaque Provider key.
 * @param authSessionId Opaque authentication session ID.
 * @param enabled Whether the owning authentication surface is active.
 * @returns Reactive session query.
 */
export function useProviderAuthSession(
  providerKey: string,
  authSessionId: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.providerAuthSession(providerKey, authSessionId ?? ''),
    queryFn: ({ signal }) => getProviderAuthSession(providerKey, authSessionId ?? '', signal),
    enabled: enabled && authSessionId !== undefined,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || !TERMINAL_STATUSES.has(status) ? 750 : false;
    },
    refetchIntervalInBackground: false,
  });
}

/**
 * Starts a session and seeds its first snapshot in Query memory.
 *
 * @param providerKey Opaque Provider key.
 * @returns Start mutation containing only the non-secret auth method.
 */
export function useCreateProviderAuthSession(providerKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: ModelProviderAuthMethod) => createProviderAuthSession(providerKey, { type }),
    onSuccess(snapshot) {
      queryClient.setQueryData(queryKeys.providerAuthSession(providerKey, snapshot.id), snapshot);
    },
  });
}

/**
 * Cancels and removes one session from Query memory.
 *
 * @param providerKey Opaque Provider key.
 * @returns Cancellation callback and cache cleanup callback.
 */
export function useProviderAuthSessionCleanup(providerKey: string) {
  const queryClient = useQueryClient();
  return {
    cancel(authSessionId: string): Promise<void> {
      return cancelProviderAuthSession(providerKey, authSessionId);
    },
    remove(authSessionId: string): void {
      queryClient.removeQueries({
        queryKey: queryKeys.providerAuthSession(providerKey, authSessionId),
        exact: true,
      });
    },
  };
}

/**
 * Resets one stored Provider credential and refreshes all affected Settings snapshots.
 *
 * @param providerKey Opaque Provider key.
 * @returns Reset mutation.
 */
export function useResetProviderAuth(providerKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => resetProviderAuth(providerKey),
    async onSuccess() {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.modelProviders }),
        queryClient.invalidateQueries({ queryKey: queryKeys.modelProvider(providerKey) }),
      ]);
    },
  });
}

export interface AuthPromptSubmission {
  pending: boolean;
  error?: Error;
  /**
   * Reads the transient answer only inside the submission closure.
   */
  submit(promptId: string, readAnswer: () => string): Promise<ProviderAuthSessionDto>;
  /**
   * Clears non-secret local submission status.
   */
  reset(): void;
}

/**
 * Submits prompt answers outside TanStack Query mutation variables and cache.
 *
 * @param providerKey Opaque Provider key.
 * @param authSessionId Active authentication session ID.
 * @returns Write-only submission state.
 */
export function useAuthPromptSubmission(
  providerKey: string,
  authSessionId: string | undefined
): AuthPromptSubmission {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  return {
    pending,
    error,
    async submit(promptId, readAnswer) {
      if (authSessionId === undefined) {
        throw new Error('The authentication session is not active.');
      }
      setPending(true);
      setError(undefined);
      try {
        const snapshot = await answerProviderAuthPrompt(providerKey, authSessionId, {
          promptId,
          answer: readAnswer(),
        });
        queryClient.setQueryData(queryKeys.providerAuthSession(providerKey, authSessionId), snapshot);
        return snapshot;
      } catch (cause) {
        const nextError = cause instanceof Error ? cause : new Error('Authentication answer failed.');
        setError(nextError);
        throw nextError;
      } finally {
        setPending(false);
      }
    },
    reset() {
      setError(undefined);
      setPending(false);
    },
  };
}

/**
 * Identifies authentication sessions that no longer require polling or cancellation.
 */
export function isProviderAuthSessionTerminal(status: ProviderAuthSessionDto['status']): boolean {
  return TERMINAL_STATUSES.has(status);
}
