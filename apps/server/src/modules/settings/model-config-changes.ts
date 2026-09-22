/**
 * @author Codex
 * @description Adapts model configuration commits to the Host notification boundary without exposing routes to services.
 */
import { MODEL_CONFIG_ROUTE } from '../../lib/runtime-config/config-routes.js';
import type { RuntimeConfigChanges } from '../../lib/runtime-config/runtime-config-changes.js';

export interface ModelConfigChanges {
  /**
   * Records one confirmed commit; the caller owns changed detection and exactly-once reporting.
   */
  recordCommitted(): void;
  /**
   * Refreshes unsubmitted model intent without marking established conversations stale.
   */
  recordDefaultCommitted?(): void;
}

/**
 * Creates a stateless model adapter over the shared Host revision recorder.
 */
export function createModelConfigChanges(
  changes: Pick<RuntimeConfigChanges, 'record'>,
  onDefault: () => void = () => undefined
): ModelConfigChanges {
  return { recordCommitted: () => changes.record(MODEL_CONFIG_ROUTE), recordDefaultCommitted: onDefault };
}
