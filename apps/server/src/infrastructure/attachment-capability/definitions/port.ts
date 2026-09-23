/**
 * @author root
 * @description Defines the pure attachment capability resolver port consumed by services and adapters.
 */

import type {
  AttachmentCapabilityResolution,
  AttachmentEvidence,
  AttachmentResolutionContext,
} from './types.js';

export interface AttachmentCapabilityResolver {
  /**
   * Resolves immutable admission, processing, and delivery decisions without performing I/O.
   *
   * @param evidence Bounded evidence collected by trusted probes.
   * @param context Explicit deployment, policy, tool, and model capabilities.
   * @returns A deterministic resolution with stable diagnostics.
   */
  resolve(evidence: AttachmentEvidence, context: AttachmentResolutionContext): AttachmentCapabilityResolution;
}
