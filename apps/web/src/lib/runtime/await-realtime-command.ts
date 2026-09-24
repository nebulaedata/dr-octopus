/**
 * @author Codex
 * @description Correlates one realtime command with its acknowledgement, failure, disconnect, or deadline.
 */
import type { RealtimeClient } from '@/lib/runtime/realtime-client';

/**
 * Subscribes before dispatch and releases observers on every outcome. A timeout does not cancel server work.
 * @param client Transport providing messages and connection state.
 * @param requestId Identity of the command being dispatched.
 * @param dispatch Sends through the existing command-retention boundary.
 * @param timeoutMs Maximum acknowledgement wait, longer than the server stop deadline by default.
 */
export function awaitRealtimeCommand(
  client: Pick<RealtimeClient, 'onMessage' | 'subscribeState' | 'getState'>,
  requestId: string,
  dispatch: () => void,
  timeoutMs = 20_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    /**
     * Settles once and releases both transport subscriptions and the deadline.
     */
    function finish(error?: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      unsubscribeMessage();
      unsubscribeState();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
    const unsubscribeMessage = client.onMessage((message) => {
      if (!('requestId' in message) || message.requestId !== requestId) {
        return;
      }
      if (message.type === 'command.ack') {
        finish();
      } else if (message.type === 'error') {
        finish(new Error(message.message));
      }
    });
    const unsubscribeState = client.subscribeState(() => {
      if (client.getState() !== 'connected') {
        finish(new Error('Connection lost before the command was confirmed. Reconnect and retry.'));
      }
    });
    const timer = setTimeout(
      () => finish(new Error('Command confirmation timed out. Check the session state and retry.')),
      timeoutMs
    );
    try {
      dispatch();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
