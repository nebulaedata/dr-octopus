/**
 * @author Codex
 * @description Wires Pi lifecycle events to the centralized Scheduler completion coordinator.
 */
import { SchedulerResultDelivery } from '../services/result-delivery.js';
import type { SchedulerDelivery, SchedulerOriginSessionPort } from '../definitions/delivery.js';
import type { SchedulerControlClient } from '../definitions/port.js';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/**
 * Adapt only the current legal Pi Session owner; all retry and acknowledgement policy stays in the coordinator.
 */
function originSession(pi: ExtensionAPI, ctx: ExtensionContext): SchedulerOriginSessionPort {
  const findEvidence = (deliveryId: string): string | null => {
    const entry = ctx.sessionManager
      .getEntries()
      .find(
        (candidate) =>
          candidate.type === 'custom_message' &&
          candidate.customType === 'octopus-scheduler-completion' &&
          candidate.details !== null &&
          typeof candidate.details === 'object' &&
          (candidate.details as { deliveryId?: unknown }).deliveryId === deliveryId
      );
    return entry?.id ?? null;
  };
  return {
    isReady: () => ctx.isIdle() && !ctx.hasPendingMessages(),
    findEvidence,
    append(delivery: SchedulerDelivery) {
      if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        return null;
      }
      pi.sendMessage(
        {
          customType: 'octopus-scheduler-completion',
          content: [
            `Scheduled task “${delivery.taskName}” finished with status ${delivery.runStatus}.`,
            delivery.summary,
            `Result: ${delivery.resultRef}`,
          ].join('\n\n'),
          display: true,
          details: {
            version: 1,
            deliveryId: delivery.id,
            runId: delivery.runId,
            taskId: delivery.taskId,
            status: delivery.runStatus,
            resultRef: delivery.resultRef,
          },
        },
        { triggerTurn: false }
      );
      return findEvidence(delivery.id);
    },
  };
}

/**
 * Event handlers only signal readiness changes; the coordinator owns every delivery branch.
 */
export function registerSchedulerEvents(pi: ExtensionAPI, client: SchedulerControlClient): void {
  let delivery: SchedulerResultDelivery | undefined;
  pi.on('session_start', (_event, ctx) => {
    void client.connect?.().catch(() => undefined);
    const originSessionRef = ctx.sessionManager.getSessionId();
    const port = client.forOrigin?.(originSessionRef);
    if (!port) {
      return;
    }
    delivery?.dispose();
    delivery = new SchedulerResultDelivery(port, originSession(pi, ctx));
    delivery.start();
  });
  pi.on('agent_settled', () => delivery?.reconcile('agent-settled'));
  pi.on('session_shutdown', () => {
    delivery?.dispose();
    delivery = undefined;
  });
}
