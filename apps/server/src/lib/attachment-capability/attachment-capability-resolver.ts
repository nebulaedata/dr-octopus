/**
 * @author root
 * @description Implements deterministic deny-first attachment classification, processing planning, and Agent delivery resolution.
 */

import {
  ATTACHMENT_RULE_VERSION,
  DOCUMENT_FORMATS,
  IMAGE_FORMATS,
  MEDIA_FORMATS,
  PRODUCT_FORMATS,
  TEXT_FORMATS,
  requiredProcessors,
} from './classifier/media-type-rules.js';
import type { AttachmentCapabilityResolver } from './definitions/port.js';
import type {
  AgentDeliveryCapability,
  AttachmentCapabilityDiagnostic,
  AttachmentCapabilityResolution,
  AttachmentEvidence,
  AttachmentResolutionContext,
  SupportedAttachmentFormat,
} from './definitions/types.js';

const MODEL_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Creates the production pure resolver without capturing mutable deployment state.
 *
 * @returns A reusable resolver whose output depends only on its inputs.
 */
export function createAttachmentCapabilityResolver(): AttachmentCapabilityResolver {
  return { resolve: resolveAttachmentCapability };
}

/**
 * Resolves one evidence set in the fixed deny-first order required by V1.
 *
 * @param evidence File evidence produced by bounded probes.
 * @param context Effective policy and available execution capabilities.
 * @returns A deeply frozen capability resolution.
 */
export function resolveAttachmentCapability(
  evidence: AttachmentEvidence,
  context: AttachmentResolutionContext
): AttachmentCapabilityResolution {
  const denied = validateEvidence(evidence, context);
  if (denied !== undefined) {
    return freezeResolution(rejected(evidence, context, denied));
  }
  const format = evidence.formatEvidence.detectedFormat as SupportedAttachmentFormat;
  const steps = requiredProcessors(format);
  const missing = steps.filter((step) => !context.processors.has(step));
  const category = IMAGE_FORMATS.has(format)
    ? 'direct-image'
    : MEDIA_FORMATS.has(format)
      ? 'manifest-only-binary'
      : 'extractable-document';
  const diagnostics: AttachmentCapabilityDiagnostic[] = [];
  if (missing.length > 0) {
    diagnostics.push(
      error('ATTACHMENT_PROCESSOR_UNAVAILABLE', 'A required attachment processor is unavailable.', true)
    );
  }
  const delivery = createDeliveryCapabilities(format, context, diagnostics);
  return freezeResolution({
    category,
    decision: missing.length > 0 ? 'defer' : 'allow',
    detectedMediaType: evidence.detectedMediaType,
    processingPlan: { steps, required: steps.length > 0 },
    deliveryCapabilities: delivery,
    limits: {
      ...(IMAGE_FORMATS.has(format) ? { maxDerivedImageBytes: MODEL_IMAGE_BYTES } : {}),
      ...(DOCUMENT_FORMATS.has(format) ? { maxInlineCharacters: context.policy.maxInlineCharacters } : {}),
      ...(format === 'pdf' ? { maxPages: context.policy.maxDocumentPages } : {}),
    },
    diagnostics,
    policyVersion: context.policy.version,
    ruleVersion: ATTACHMENT_RULE_VERSION,
  });
}

/**
 * Applies evidence shape, immutable denials, format agreement, and structure limits.
 */
function validateEvidence(
  evidence: AttachmentEvidence,
  context: AttachmentResolutionContext
): AttachmentCapabilityDiagnostic | undefined {
  if (
    !Number.isSafeInteger(evidence.byteSize) ||
    evidence.byteSize <= 0 ||
    evidence.byteSize > context.policy.maxAttachmentBytes
  ) {
    return error(
      'ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED',
      'Attachment size is outside the allowed range.',
      false
    );
  }
  const format = evidence.formatEvidence.detectedFormat;
  if (format === 'unknown' || !PRODUCT_FORMATS.has(format)) {
    return error('ATTACHMENT_TYPE_UNSUPPORTED', 'Attachment format is not supported.', false);
  }
  if (!evidence.formatEvidence.extensionMatched) {
    return error(
      'ATTACHMENT_EXTENSION_MISMATCH',
      'Filename extension does not match the detected format.',
      false
    );
  }
  if (!evidence.formatEvidence.mediaTypeMatched) {
    return error('ATTACHMENT_MEDIA_TYPE_MISMATCH', 'Media type does not match the detected format.', false);
  }
  if (!evidence.formatEvidence.magicMatched) {
    return error('ATTACHMENT_MAGIC_MISMATCH', 'File signature does not match the detected format.', false);
  }
  if (['pdf', 'docx', 'xlsx', 'pptx'].includes(format) && evidence.formatEvidence.containerMatched !== true) {
    return error('ATTACHMENT_CONTAINER_INVALID', 'Document container structure is invalid.', false);
  }
  const structure = evidence.structure;
  if (
    structure?.hasMacros ||
    structure?.hasActiveContent ||
    (structure?.hasEmbeddedObject && !['docx', 'pptx', 'xlsx'].includes(format)) ||
    structure?.hasExternalRelationships
  ) {
    return error('ATTACHMENT_ACTIVE_CONTENT_FORBIDDEN', 'Active or embedded content is forbidden.', false);
  }
  if (
    (structure?.entryCount ?? 0) > 10_000 ||
    (structure?.uncompressedBytes ?? 0) > 512 * 1024 * 1024 ||
    (structure?.compressionRatio ?? 0) > 100
  ) {
    return error(
      'ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED',
      'Attachment container exceeds structural limits.',
      false
    );
  }
  const pixels = (structure?.width ?? 0) * (structure?.height ?? 0);
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > context.policy.maxImagePixels ||
    (structure?.pageCount ?? 0) > context.policy.maxDocumentPages
  ) {
    return error(
      'ATTACHMENT_STRUCTURE_LIMIT_EXCEEDED',
      'Attachment structure exceeds a product safety limit.',
      false
    );
  }
  if (!context.policy.allowedFormats.has(format) || context.policy.deniedFormats.has(format)) {
    return error('ATTACHMENT_POLICY_REJECTED', 'Attachment format is denied by policy.', false);
  }
  return undefined;
}

/**
 * Derives only delivery modes supported by the model, tools, retrieval, and policy.
 */
function createDeliveryCapabilities(
  format: SupportedAttachmentFormat,
  context: AttachmentResolutionContext,
  diagnostics: AttachmentCapabilityDiagnostic[]
): AgentDeliveryCapability[] {
  if (MEDIA_FORMATS.has(format)) {
    return ['manifest-only'];
  }
  if (IMAGE_FORMATS.has(format)) {
    if (context.agent === undefined || context.agent.modelInputs.has('image')) {
      return ['rpc-image'];
    }
    diagnostics.push(
      error('MODEL_INPUT_UNSUPPORTED', 'The selected model does not accept image input.', true)
    );
    return context.policy.allowMaterialization && context.tools.has('read-file') ? ['manifest-path'] : [];
  }
  const delivery: AgentDeliveryCapability[] = [];
  if (
    TEXT_FORMATS.has(format) &&
    (context.agent?.maxContextCharacters ?? context.policy.maxInlineCharacters) > 0
  ) {
    delivery.push('inline-text');
  }
  if (context.policy.allowMaterialization && context.tools.has('read-file')) {
    delivery.push('manifest-path');
  }
  if (context.retrieval.has('structured-file-read') || context.retrieval.has('lexical-search')) {
    delivery.push('retrieval');
  }
  if (delivery.length === 0) {
    diagnostics.push(error('AGENT_TOOL_UNAVAILABLE', 'No permitted Agent delivery path is available.', true));
  }
  return delivery;
}

/**
 * Creates a stable error diagnostic without implementation details.
 */
function error(
  code: AttachmentCapabilityDiagnostic['code'],
  message: string,
  retryable: boolean
): AttachmentCapabilityDiagnostic {
  return { code, severity: 'error', retryable, message };
}

/**
 * Creates the canonical rejected resolution.
 */
function rejected(
  evidence: AttachmentEvidence,
  context: AttachmentResolutionContext,
  diagnostic: AttachmentCapabilityDiagnostic
): AttachmentCapabilityResolution {
  return {
    category: 'rejected',
    decision: 'reject',
    detectedMediaType: evidence.detectedMediaType,
    processingPlan: { steps: [], required: false },
    deliveryCapabilities: ['none'],
    limits: {},
    diagnostics: [diagnostic],
    policyVersion: context.policy.version,
    ruleVersion: ATTACHMENT_RULE_VERSION,
  };
}

/**
 * Freezes every mutable collection exposed by a resolution.
 */
function freezeResolution(resolution: AttachmentCapabilityResolution): AttachmentCapabilityResolution {
  Object.freeze(resolution.processingPlan.steps);
  Object.freeze(resolution.processingPlan);
  Object.freeze(resolution.deliveryCapabilities);
  Object.freeze(resolution.limits);
  for (const diagnostic of resolution.diagnostics) {
    Object.freeze(diagnostic);
  }
  Object.freeze(resolution.diagnostics);
  return Object.freeze(resolution);
}
