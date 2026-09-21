/**
 * @author Codex
 * @description Coordinates realtime Session projections through TanStack Query.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionStores } from '../stores/session';
import { realtimeClient } from '../utils/realtime-client';
import { browserSessionRuntime } from '../lib/runtime/session-runtime';
import { queryKeys } from './query-keys';
import { sessionBootstrapQueryOptions } from './session-queries';
import { createRealtimeMessageHandler } from './realtime-message-handler';
import type { SessionProjectionState } from '../stores/session';
import type { SessionDto } from '@octopus/shared/protocol';

/**
 * Replaces one cached Session with the authoritative projection returned by a runtime snapshot.
 */
function replaceSession(sessions: SessionDto[] | undefined, session: SessionDto): SessionDto[] | undefined {
  if (session.isDraft) {
    return sessions;
  }
  return sessions?.map((candidate) => {
    if (candidate.id !== session.id) {
      return candidate;
    }
    if (candidate.runtime && session.runtime && candidate.runtime.epoch > session.runtime.epoch) {
      return candidate;
    }
    return { ...session, runtimeControl: candidate.runtimeControl ?? session.runtimeControl };
  });
}

/**
 * Detects a projection whose background subscription kept it authoritative while its view was closed.
 */
function canWarmActivateSession(state: SessionProjectionState): boolean {
  return (
    state.loadState === 'ready' &&
    state.hydrated &&
    (state.pendingUserRequestIds.length > 0 ||
      ['starting', 'running', 'recovering', 'stopping'].includes(state.runtimeState))
  );
}

/**
 * Owns the process-level socket and reconciles sequence gaps through QueryClient.
 */
export function useRealtimeLifecycle(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribeCatalog = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.query.queryKey[0] !== 'sessions') {
        return;
      }
      const sessions = event.query.state.data as SessionDto[] | undefined;
      for (const session of sessions ?? []) {
        if (
          session.runtime &&
          session.runtimeControl?.restart.status !== 'restarting' &&
          realtimeClient.needsSubscriptionRefresh(session.id, session.runtime)
        ) {
          sessionStores.ensure(session.id).getState().beginBootstrap();
          browserSessionRuntime.refreshSessionSubscription(session.id);
        }
      }
    });
    const unsubscribe = realtimeClient.onMessage(
      createRealtimeMessageHandler({ queryClient, realtimeClient, browserSessionRuntime, sessionStores })
    );
    realtimeClient.connect();
    const cleanupInterval = window.setInterval(() => sessionStores.cleanup(), 30_000);
    return () => {
      unsubscribeCatalog();
      unsubscribe();
      realtimeClient.disconnect();
      window.clearInterval(cleanupInterval);
    };
  }, [queryClient]);
}

/**
 * Hydrates and subscribes the active Session through a Query-managed snapshot.
 */
export function useSessionRuntime(workspaceId: string, sessionId: string, enabled = true) {
  const queryClient = useQueryClient();
  const store = sessionStores.ensure(sessionId);
  const hydratedAt = useRef(0);
  const [warmProjection] = useState(() => canWarmActivateSession(store.getState()));
  const subscription = useSyncExternalStore(
    (listener) => realtimeClient.subscribeState(listener),
    () => realtimeClient.getConfirmedSubscription(sessionId),
    () => undefined
  );
  const bootstrap = useQuery({ ...sessionBootstrapQueryOptions(workspaceId, sessionId), enabled });
  const currentBootstrap = !bootstrap.isFetching && bootstrap.isSuccess ? bootstrap.data : undefined;
  const identityMatches =
    currentBootstrap !== undefined &&
    subscription !== undefined &&
    currentBootstrap.readiness.runtimeId === subscription.runtimeId &&
    currentBootstrap.readiness.epoch === subscription.epoch;
  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    hydratedAt.current = 0;
    if (!warmProjection) {
      store.getState().beginBootstrap();
    }
    return browserSessionRuntime.openView(sessionId);
  }, [enabled, sessionId, store, warmProjection]);
  useEffect(() => {
    if (currentBootstrap !== undefined && subscription !== undefined) {
      if (!identityMatches) {
        store
          .getState()
          .failBootstrap('Session runtime changed while resources were loading. Retry the Session.');
        return;
      }
      if (hydratedAt.current === bootstrap.dataUpdatedAt) {
        return;
      }
      hydratedAt.current = bootstrap.dataUpdatedAt;
      const current = store.getState();
      // Preserve an in-flight first prompt when home navigation races the server's persisted snapshot.
      if (!(
        current.hydrated &&
        current.runtimeId === subscription.runtimeId &&
        current.epoch === subscription.epoch &&
        current.pendingUserRequestIds.length > 0 &&
        current.lastSequence >= currentBootstrap.sequence
      )) {
        current.hydrate(currentBootstrap);
      }
      browserSessionRuntime.adoptRuntimeState(sessionId, store.getState().runtimeState);
      queryClient.setQueryData<SessionDto[]>(queryKeys.sessions(workspaceId), (sessions) =>
        replaceSession(sessions, currentBootstrap.session)
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(workspaceId) });
    }
  }, [
    bootstrap.dataUpdatedAt,
    currentBootstrap,
    identityMatches,
    queryClient,
    sessionId,
    store,
    subscription,
    workspaceId,
  ]);
  useEffect(() => {
    if (bootstrap.error !== null) {
      if (warmProjection) {
        store.getState().setError(bootstrap.error.message);
      } else {
        store.getState().failBootstrap(bootstrap.error.message);
      }
    }
  }, [bootstrap.error, store, warmProjection]);
  return {
    currentBootstrap,
    identityMatches,
    loading: !warmProjection && !identityMatches && bootstrap.error === null,
    query: bootstrap,
    subscription,
    warmProjection,
  };
}
