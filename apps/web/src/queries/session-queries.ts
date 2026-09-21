/**
 * @author Codex
 * @description Exposes active Session data and mutations through TanStack Query.
 */

import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  cloneSession,
  forkSession,
  getSessionBootstrap,
  getSessionHistory,
  getSessionSnapshot,
  getSessionTree,
  submitMessageFeedback,
  updateSessionPreferences,
} from '../api/sessions';
import { queryKeys } from './query-keys';
import { sessionStores } from '../stores/session';
import type { SessionDto, SessionPreferencesDto } from '@octopus/shared/protocol';
import type { MessageProjection } from '../stores/session';

/**
 * Reads a display-only transcript without waiting for a Session runtime.
 */
export function sessionHistoryQueryOptions(workspaceId: string, sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.history(workspaceId, sessionId),
    queryFn: ({ signal }) => getSessionHistory(workspaceId, sessionId, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Creates the authoritative runtime snapshot query used for realtime reconciliation.
 */
export function sessionSnapshotQueryOptions(workspaceId: string, sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.snapshot(workspaceId, sessionId),
    queryFn: ({ signal }) => getSessionSnapshot(workspaceId, sessionId, signal),
    retry: false,
  });
}

/**
 * Creates the complete Session bootstrap query used by the active Composer route.
 */
export function sessionBootstrapQueryOptions(workspaceId: string, sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.bootstrap(workspaceId, sessionId),
    queryFn: ({ signal }) => getSessionBootstrap(workspaceId, sessionId, signal),
    gcTime: 0,
    refetchOnMount: 'always',
    retry: false,
    staleTime: 0,
  });
}

/**
 * Persists Session preferences and refreshes the containing catalog.
 */
export function useUpdateSessionPreferences(session: SessionDto) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preferences: Partial<SessionPreferencesDto>) =>
      updateSessionPreferences(session.workspaceId, session.id, preferences),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(session.workspaceId) });
    },
  });
}

/**
 * Forks or clones a Session and refreshes the containing Workspace catalog.
 *
 * Callers handle success navigation or errors through the returned mutation state.
 */
export function useDeriveSession(session: SessionDto) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: 'fork' | 'clone') => {
      if (mode === 'clone') {
        return cloneSession(session.workspaceId, session.id);
      }
      const history = await getSessionTree(session.workspaceId, session.id);
      if (history.leafId === null) {
        throw new Error('This Session does not have a forkable history entry yet.');
      }
      return forkSession(session.workspaceId, session.id, history.leafId);
    },
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(session.workspaceId) });
    },
  });
}

/**
 * Forks a Session from a specific history entry.
 *
 * Callers handle success navigation or errors through the returned mutation state.
 */
export function useForkSessionFromEntry(session: SessionDto) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => forkSession(session.workspaceId, session.id, entryId),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(session.workspaceId) });
    },
  });
}

/**
 * Persists thumbs-up/thumbs-down feedback for one Session history entry.
 */
export function useSubmitMessageFeedback(session: SessionDto) {
  return useMutation({
    mutationFn: ({ entryId, rating }: { entryId: string; rating: 'up' | 'down' }) =>
      submitMessageFeedback(session.workspaceId, session.id, entryId, rating),
    onMutate(variables) {
      const store = sessionStores.ensure(session.id);
      let previousFeedback: MessageProjection['feedback'];
      store.setState((state) => {
        const messageId = state.messageIds.find(
          (id) => state.messagesById[id]?.entryId === variables.entryId
        );
        if (messageId === undefined) {
          return state;
        }
        const message = state.messagesById[messageId];
        if (message === undefined) {
          return state;
        }
        previousFeedback = message.feedback;
        return {
          ...state,
          messagesById: {
            ...state.messagesById,
            [messageId]: { ...message, feedback: variables.rating },
          },
        };
      });
      return { previousFeedback };
    },
    onError(_error, variables, context) {
      if (context?.previousFeedback === undefined) {
        return;
      }
      const store = sessionStores.ensure(session.id);
      store.setState((state) => {
        const messageId = state.messageIds.find(
          (id) => state.messagesById[id]?.entryId === variables.entryId
        );
        if (messageId === undefined) {
          return state;
        }
        const message = state.messagesById[messageId];
        if (message === undefined) {
          return state;
        }
        return {
          ...state,
          messagesById: {
            ...state.messagesById,
            [messageId]: { ...message, feedback: context.previousFeedback },
          },
        };
      });
    },
    onSuccess(_data, variables) {
      const store = sessionStores.ensure(session.id);
      store.setState((state) => {
        const messageId = state.messageIds.find(
          (id) => state.messagesById[id]?.entryId === variables.entryId
        );
        if (messageId === undefined) {
          return state;
        }
        const message = state.messagesById[messageId];
        if (message === undefined || message.feedback === variables.rating) {
          return state;
        }
        return {
          ...state,
          messagesById: {
            ...state.messagesById,
            [messageId]: { ...message, feedback: variables.rating },
          },
        };
      });
    },
  });
}
