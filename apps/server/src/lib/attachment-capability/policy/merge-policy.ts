/**
 * @author root
 * @description Combines attachment policies using monotonic security rules that cannot widen the product ceiling.
 */

import { PRODUCT_FORMATS } from '../classifier/media-type-rules.js';
import type { AttachmentSecurityPolicy, SupportedAttachmentFormat } from '../definitions/types.js';

/**
 * Intersects allow-lists, unions denials, and takes the strictest numerical and boolean limits.
 *
 * @param policies Ordered policies from product ceiling to request restrictions.
 * @returns A new immutable effective policy.
 */
export function mergeAttachmentPolicies(
  ...policies: readonly AttachmentSecurityPolicy[]
): AttachmentSecurityPolicy {
  if (policies.length === 0) {
    throw new Error('At least one attachment policy is required.');
  }
  const allowed = new Set<SupportedAttachmentFormat>(PRODUCT_FORMATS);
  const denied = new Set<SupportedAttachmentFormat>();
  for (const policy of policies) {
    for (const format of [...allowed]) {
      if (!policy.allowedFormats.has(format)) {
        allowed.delete(format);
      }
    }
    for (const format of policy.deniedFormats) {
      denied.add(format);
    }
  }
  return Object.freeze({
    version: policies.map((policy) => policy.version).join('+'),
    allowedFormats: allowed,
    deniedFormats: denied,
    maxAttachmentBytes: Math.min(...policies.map((policy) => policy.maxAttachmentBytes)),
    maxImagePixels: Math.min(...policies.map((policy) => policy.maxImagePixels)),
    maxDocumentPages: Math.min(...policies.map((policy) => policy.maxDocumentPages)),
    maxInlineCharacters: Math.min(...policies.map((policy) => policy.maxInlineCharacters)),
    allowMaterialization: policies.every((policy) => policy.allowMaterialization),
  });
}
