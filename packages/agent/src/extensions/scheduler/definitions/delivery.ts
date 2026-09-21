/**
 * @author Codex
 * @description Safe completion-delivery contracts shared by daemon SDK and source Session coordinator.
 */
export interface SchedulerDelivery {
  id: string;
  runId: string;
  taskId: string;
  taskName: string;
  runStatus: string;
  kind: 'run-completed';
  payloadVersion: 1;
  summary: string;
  resultRef: string;
  createdAt: string;
  availableAt: string;
  attempts: number;
}

export interface SchedulerDeliveryPage {
  items: SchedulerDelivery[];
}

export interface SchedulerDeliveryReceipt {
  id: string;
  status: 'pending' | 'delivered' | 'undeliverable';
  originEntryId: string | null;
}

export interface SchedulerDeliveryPort {
  /**
   * Acquire the process-level source Session fence before reading or appending completions.
   */
  acquireLease(): Promise<{ release(): void } | null>;
  /**
   * List due pending completions for the bound source Session.
   */
  listPending(signal?: AbortSignal): Promise<SchedulerDeliveryPage>;
  /**
   * Confirm evidence only after it exists in the source Session history.
   */
  ack(deliveryId: string, originEntryId: string, signal?: AbortSignal): Promise<SchedulerDeliveryReceipt>;
  /**
   * Keep a temporary failure pending with an absolute retry instant.
   */
  defer(
    deliveryId: string,
    availableAt: string,
    errorCode: string,
    signal?: AbortSignal
  ): Promise<SchedulerDeliveryReceipt>;
}

export interface SchedulerOriginSessionPort {
  /**
   * Report whether this exact Session owner can synchronously persist a passive message.
   */
  isReady(): boolean;
  /**
   * Search complete append history for an existing delivery identity.
   */
  findEvidence(deliveryId: string): string | null;
  /**
   * Append without triggering a model turn and return only verified persisted evidence.
   */
  append(delivery: SchedulerDelivery): string | null;
}
