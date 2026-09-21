/**
 * @author Codex
 * @description Defines the narrow request port used by the Scheduler Pi adapter.
 */
import type { SchedulerDeliveryPort } from './delivery.js';
import type { SchedulerSettings, SchedulerSettingsUpdate } from './settings.js';

export interface SchedulerRequest {
  operation:
    | 'authorization-preview'
    | 'authorize'
    | 'revoke-authorization'
    | 'create'
    | 'list'
    | 'get'
    | 'update'
    | 'delete'
    | 'restore'
    | 'purge'
    | 'run-now'
    | 'cancel'
    | 'history'
    | 'transcript'
    | 'run-result'
    | 'delivery-list'
    | 'delivery-ack'
    | 'delivery-defer';
  taskId?: string;
  revision?: number;
  limit?: number;
  offset?: number;
  key?: string;
  input?: unknown;
  deliveryId?: string;
  originEntryId?: string;
  availableAt?: string;
  errorCode?: string;
  signal?: AbortSignal;
}
export interface SchedulerRequestCaller {
  /**
   * Agent Session identity captured by the adapter, never accepted from model tool arguments.
   */
  originSessionRef?: string | null;
}
export interface SchedulerControlClient {
  /**
   * Ensure or discover task control without granting lifecycle stop authority.
   */
  connect?(): Promise<unknown>;
  /**
   * Read service status without starting it.
   */
  status?(): Promise<unknown>;
  /**
   * Explicit user-command lifecycle control; never exposed as a model tool or implicit ensure.
   */
  controlService?(action: 'start' | 'stop' | 'restart'): Promise<unknown>;
  /**
   * Read the shared cron.json configuration.
   */
  getSettings?(): Promise<SchedulerSettings>;
  /**
   * Replace the shared cron.json configuration at the observed revision.
   */
  updateSettings?(input: SchedulerSettingsUpdate): Promise<SchedulerSettings>;
  /**
   * Bind completion delivery access to one exact source Session.
   */
  forOrigin?(originSessionRef: string): SchedulerDeliveryPort;
  /**
   * Waits for the authoritative Agent scheduler response or a bounded transport error.
   */
  request(request: SchedulerRequest, caller?: SchedulerRequestCaller): Promise<unknown>;
  /**
   * Aborts accepted network work and rejects future use of this extension instance.
   */
  close(): void;
}
