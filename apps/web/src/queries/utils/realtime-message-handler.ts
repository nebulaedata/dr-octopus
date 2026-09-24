/**
 * @author Codex
 * @description Orders realtime generation checks, command settlement and Session snapshot hydration.
 */
import { queryKeys } from '@/queries/core/query-keys';
import { sessionSnapshotQueryOptions } from '@/queries/session-queries';
import type { QueryClient } from '@tanstack/react-query';
import type { HostEventEnvelope, ServerRealtimeMessage } from '@octopus/shared/protocol';
import type { RealtimeClient } from '@/lib/runtime/realtime-client';
import type { SessionRuntimeRegistry } from '@/lib/runtime/session-runtime-registry';
import type { SessionStoreRegistry } from '@/stores/session';

interface RealtimeMessageDependencies {
  queryClient: Pick<QueryClient, 'invalidateQueries' | 'fetchQuery'>;
  realtimeClient: Pick<RealtimeClient, 'getConfirmedSubscription'>;
  browserSessionRuntime: Pick<SessionRuntimeRegistry, 'observe'>;
  sessionStores: Pick<SessionStoreRegistry, 'ensure'>;
}

/**
 * Narrows an arbitrary realtime message to a Session event envelope.
 */
function isHostEventEnvelope(message: unknown): message is HostEventEnvelope {
  return (
    typeof message === 'object' &&
    message !== null &&
    'sessionId' in message &&
    'sequence' in message &&
    typeof (message as Record<string, unknown>)['sessionId'] === 'string' &&
    typeof (message as Record<string, unknown>)['sequence'] === 'number'
  );
}

/**
 * Creates one subscription's message handler with isolated sequence-gap reconciliation.
 */
export function createRealtimeMessageHandler({
  queryClient,
  realtimeClient,
  browserSessionRuntime,
  sessionStores,
}: RealtimeMessageDependencies): (message: ServerRealtimeMessage) => void {
  const reconciling = new Set<string>();
  return (message) => {
    // Validate before observe can release the final subscription for a terminal event.
    if (message.type === 'command.ack' && message.completion !== undefined) {
      if (message.sessionId === undefined) {
        return;
      }
      const binding = realtimeClient.getConfirmedSubscription(message.sessionId);
      if (
        !binding ||
        binding.runtimeId !== message.completion.runtimeId ||
        binding.epoch !== message.completion.epoch
      ) {
        return;
      }
    }
    if (isHostEventEnvelope(message)) {
      const binding = realtimeClient.getConfirmedSubscription(message.sessionId);
      if (!binding || binding.runtimeId !== message.runtimeId || binding.epoch !== message.epoch) {
        return;
      }
    }
    if (message.type === 'session.subscribed' && message.runtime) {
      const { workspaceId, sessionId } = message.runtime;
      void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap(workspaceId, sessionId) });
      const store = sessionStores.ensure(sessionId);
      if (store.getState().runtimeId !== message.runtime.runtimeId) {
        void queryClient
          .fetchQuery(sessionSnapshotQueryOptions(workspaceId, sessionId))
          .then((snapshot) => {
            const current = realtimeClient.getConfirmedSubscription(sessionId);
            const state = store.getState();
            if (
              current?.runtimeId === message.runtime?.runtimeId &&
              snapshot.runtime?.runtimeId === current?.runtimeId &&
              snapshot.runtime?.epoch === current?.epoch &&
              !(state.hydrated && state.runtimeId === current?.runtimeId && state.epoch === current?.epoch)
            ) {
              // Bootstrap may already have hydrated this generation and accepted a new prompt.
              state.hydrate(snapshot);
            }
          })
          .catch(() => undefined);
      }
    }
    if (
      isHostEventEnvelope(message) &&
      message.type === 'agent.event' &&
      typeof message.payload === 'object' &&
      message.payload !== null &&
      'type' in message.payload &&
      ['message_end', 'agent_settled'].includes(String(message.payload.type))
    ) {
      void queryClient.invalidateQueries({
        queryKey: ['session-stats', message.workspaceId, message.sessionId],
      });
    }
    const failedCommand = browserSessionRuntime.observe(message);
    if (failedCommand !== undefined) {
      // A rejected control may have an optimistic catalog value even when no Server mutation event fired.
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      const state = sessionStores.ensure(failedCommand.sessionId).getState();
      state.rejectOptimisticUserMessage(failedCommand.requestId, failedCommand.message);
      state.rejectWorkModeChange(failedCommand.requestId, failedCommand.message);
    }
    if (message.type === 'command.ack' && message.sessionId !== undefined && message.thinking !== undefined) {
      sessionStores.ensure(message.sessionId).getState().setThinking(message.thinking);
    }
    if (
      message.type === 'command.ack' &&
      message.sessionId !== undefined &&
      message.permission !== undefined
    ) {
      sessionStores.ensure(message.sessionId).getState().setPermission(message.permission);
    }
    if (message.type === 'command.ack' && message.sessionId !== undefined && message.planMode !== undefined) {
      sessionStores.ensure(message.sessionId).getState().setPlanMode(message.planMode, message.requestId);
    }
    if (message.type === 'command.ack' && message.sessionId !== undefined) {
      const state = sessionStores.ensure(message.sessionId).getState();
      if (state.pendingUserRequestIds.includes(message.requestId)) {
        state.setAttachments([]);
      }
      state.acknowledgeUserCommand(message.requestId, message.completion);
    }
    if (!isHostEventEnvelope(message)) {
      return;
    }
    const store = sessionStores.ensure(message.sessionId);
    store.getState().applyEvent(message);
    if (!store.getState().needsReconcile || reconciling.has(message.sessionId)) {
      return;
    }
    reconciling.add(message.sessionId);
    void queryClient
      .fetchQuery(sessionSnapshotQueryOptions(message.workspaceId, message.sessionId))
      .then((snapshot) => store.getState().hydrate(snapshot))
      .catch((error: unknown) =>
        store.getState().setError(error instanceof Error ? error.message : 'Recovery failed.')
      )
      .finally(() => reconciling.delete(message.sessionId));
  };
}
