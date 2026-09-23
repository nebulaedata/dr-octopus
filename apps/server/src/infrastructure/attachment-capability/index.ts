/**
 * @author root
 * @description Exposes attachment capability contracts, defaults, policy composition, and the pure resolver factory.
 */

export {
  createAttachmentCapabilityResolver,
  resolveAttachmentCapability,
} from './attachment-capability-resolver.js';
export { DEFAULT_ATTACHMENT_POLICY } from './policy/default-policy.js';
export { mergeAttachmentPolicies } from './policy/merge-policy.js';
export type { AttachmentCapabilityResolver } from './definitions/port.js';
export type {
  AgentDeliveryCapability,
  AttachmentCapabilityCategory,
  AttachmentCapabilityDiagnostic,
  AttachmentCapabilityResolution,
  AttachmentEvidence,
  AttachmentProcessorCapability,
  AttachmentResolutionContext,
  AttachmentRetrievalCapability,
  AttachmentSecurityPolicy,
  SupportedAttachmentFormat,
} from './definitions/types.js';
