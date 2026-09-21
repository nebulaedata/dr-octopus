/**
 * @author Codex
 * @description Exposes framework-neutral realtime connection state and command hooks.
 */

import { useSyncExternalStore } from 'react';
import { realtimeClient } from '../utils/realtime-client';
import { browserSessionRuntime } from '../lib/runtime/session-runtime';
import { sessionStores } from '../stores/session';
import type { ClientRealtimeMessage } from '@octopus/shared/protocol';
import type { RealtimeConnectionState } from '../utils/realtime-client';

export type { RealtimeConnectionState } from '../utils/realtime-client';

/**
 * Subscribes a component to the tab-scoped connection state.
 */
export function useRealtimeConnection(): RealtimeConnectionState {
  return useSyncExternalStore(
    (listener) => realtimeClient.subscribeState(listener),
    () => realtimeClient.getState(),
    () => 'offline'
  );
}

/**
 * Returns the typed realtime command boundary used by interactive controls.
 */
export function useRealtimeCommand(): (message: ClientRealtimeMessage) => void {
  return (message) => {
    const release = retainsSessionUntilSettled(message)
      ? browserSessionRuntime.retainCommand(
          message.sessionId,
          message.requestId,
          sessionStores.ensure(message.sessionId).getState().lastSequence,
          message.type === 'agent.set-work-mode' || message.type === 'agent.abort'
        )
      : undefined;
    try {
      realtimeClient.send(message);
    } catch (error) {
      release?.();
      throw error;
    }
  };
}

/**
 * Identifies commands whose asynchronous runtime events must survive route navigation.
 */
function retainsSessionUntilSettled(message: ClientRealtimeMessage): message is Exclude<
  ClientRealtimeMessage,
  {
    type:
      | 'ping'
      | 'session.focus'
      | 'session.subscribe'
      | 'session.unsubscribe'
      | 'agent.set-model'
      | 'agent.set-thinking'
      | 'agent.set-permission-mode'
      | 'agent.set-queue-mode'
      | 'extension.ui.response';
  }
> {
  return [
    'agent.prompt',
    'agent.steer',
    'agent.follow-up',
    'agent.abort',
    'agent.compact',
    'agent.abort-retry',
    'agent.set-work-mode',
  ].includes(message.type);
}
