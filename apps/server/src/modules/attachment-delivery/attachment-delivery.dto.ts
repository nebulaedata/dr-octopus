/**
 * @author Codex
 * @description Defines the Host attachment delivery contract without depending on persistence or prompt rendering.
 */

import type { DocumentCoverageV1 } from '@octopus/shared/protocol/attachments';

export interface ResolvedAgentAttachments {
  promptSuffix: string;
  images: Array<{ type: 'image'; data: string; mimeType: string }>;
  manifests: Array<{
    attachmentId: string;
    name: string;
    detectedMediaType: string;
    byteSize: number;
    sha256: string;
    path?: string;
    originalPath?: string;
    extractedPath?: string;
    outputDirectory?: string;
    temporaryDirectory?: string;
    coverage?: DocumentCoverageV1;
    delivery: 'content-derived' | 'manifest-only';
    contentAvailableToModel: boolean;
    artifactSchema?: {
      name: 'StructuredDocumentV1';
      version: 1;
      kindPath: 'kind';
      contentPath: 'units[].text';
      locatorPath: 'units[].locator';
      truncatedPath: 'truncated';
      diagnosticsPath: 'diagnostics[]';
    };
  }>;
  materializations: Array<{
    attachmentId: string;
    path: string;
    sourceImmutable: true;
    retention: 'workspace-permanent';
  }>;
  diagnostics: Array<{ attachmentId: string; code: string; message: string }>;
}
