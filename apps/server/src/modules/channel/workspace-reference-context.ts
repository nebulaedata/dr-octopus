/**
 * @author Codex
 * @description Serializes validated Workspace references into private Pi prompt context.
 */

import type { WorkspaceReferenceDto } from '@octopus/shared/protocol';

/**
 * Creates the model-facing suffix persisted by Pi for deterministic Session recovery.
 *
 * @param requestId Request identity used to recognize Host-owned prompt context.
 * @param references Server-validated Workspace-relative references.
 * @returns An empty string when no references exist, otherwise an escaped private prompt suffix.
 */
export function createWorkspaceReferencePromptSuffix(
  requestId: string,
  references: readonly WorkspaceReferenceDto[]
): string {
  if (references.length === 0) {
    return '';
  }
  const entries = references
    .map(
      (reference) => `  <reference kind="${reference.kind}" path="${escapeXmlAttribute(reference.path)}" />`
    )
    .join('\n');
  return `\n<host_workspace_reference_request id="${escapeXmlAttribute(requestId)}" />\n<host_workspace_references version="1" trust="untrusted-user-selected-paths">\n${entries}\n</host_workspace_references>`;
}

/**
 * Escapes untrusted path and request metadata used in XML-like prompt attributes.
 *
 * @param value Raw attribute value.
 * @returns Attribute-safe text that cannot create additional prompt elements.
 */
function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
