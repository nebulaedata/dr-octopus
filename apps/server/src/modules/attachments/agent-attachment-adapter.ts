/**
 * @author root
 * @description Adapts ready Host attachments to bounded Pi inputs and Workspace-local originals, extracted artifacts, and explicit coverage notices.
 */

import { readFile } from 'node:fs/promises';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { deliverWorkspaceAttachment } from './workspace-attachment-delivery.js';
import { attachmentDeliveryPrompt, escapeXml } from './agent-attachment-prompt.js';
import { WorkspaceAttachmentCache } from './workspace-attachment-cache.js';
import type { ResolvedAgentAttachments } from './agent-attachment-types.js';
export type { ResolvedAgentAttachments } from './agent-attachment-types.js';
import type { LocalFileBlobStore } from '../../lib/attachment-storage/local-file-blob-store.js';
import type { AttachmentsRepository } from './attachments.repository.js';
import type { AttachmentResourceDto } from '@octopus/shared/protocol/attachments';

/**
 * Applies model and prompt budgets without extending Pi's public RPC contract.
 */
export class AgentAttachmentAdapter {
  private readonly workspaceCache: WorkspaceAttachmentCache;

  /**
   * @param repository Attachment and derivative metadata authority.
   * @param blobs Immutable byte authority.
   */
  public constructor(
    private readonly repository: AttachmentsRepository,
    private readonly blobs: LocalFileBlobStore
  ) {
    this.workspaceCache = new WorkspaceAttachmentCache(blobs);
  }

  /**
   * Resolves one frozen ready list into bounded images, text manifests, and verified materializations.
   */
  public async resolve(
    items: readonly AttachmentResourceDto[],
    input: {
      sessionId: string;
      workspaceCwd: string;
      modelInputs: ReadonlySet<'text' | 'image'>;
      maxInlineCharacters: number;
    }
  ): Promise<ResolvedAgentAttachments> {
    const result: ResolvedAgentAttachments = {
      promptSuffix: '',
      images: [],
      manifests: [],
      materializations: [],
      diagnostics: [],
    };
    let imageBytes = 0;
    let inlineCharacters = 0;
    for (const item of items) {
      const row = this.repository.getRecord(item.id);
      if (row === undefined || row.status !== 'ready' || row.sha256 === null) {
        throw new ApplicationError('ATTACHMENT_NOT_READY', 'Attachment is not ready for the Agent.', {
          statusCode: 423,
          retryable: true,
        });
      }
      const document =
        item.classification === 'extractable-document'
          ? this.repository.getDerivative(item.id, 'document-json')
          : undefined;
      const delivery = await deliverWorkspaceAttachment(this.workspaceCache, {
        workspaceCwd: input.workspaceCwd,
        sessionId: input.sessionId,
        attachmentId: item.id,
        original: {
          storageKey: this.#originalStorageKey(requireBlobSha256(row.blob_sha256)),
          artifactSha256: requireBlobSha256(row.blob_sha256),
          kind: 'original',
          filename: row.original_name,
        },
        extracted:
          document === undefined
            ? undefined
            : {
                storageKey: document.storageKey,
                artifactSha256: document.sha256,
                kind: 'document-json',
                filename: 'document.json',
              },
      });
      for (const path of [delivery.originalPath, delivery.extractedPath]) {
        if (path !== undefined) {
          result.materializations.push({
            attachmentId: item.id,
            path,
            sourceImmutable: true,
            retention: 'workspace-permanent',
          });
        }
      }
      if (item.classification === 'direct-image') {
        if (!input.modelInputs.has('image')) {
          throw new ApplicationError(
            'MODEL_INPUT_UNSUPPORTED',
            'The selected model does not accept image attachments.',
            { statusCode: 422, retryable: true }
          );
        }
        const image = this.repository.getDerivative(item.id, 'model-image');
        if (
          image === undefined ||
          result.images.length >= 4 ||
          imageBytes + image.byteSize > 8 * 1024 * 1024
        ) {
          throw new ApplicationError(
            'ATTACHMENT_SIZE_LIMIT_EXCEEDED',
            'Image attachment budget was exceeded.',
            { statusCode: 413 }
          );
        }
        const bytes = await readFile(this.blobs.resolveForProcessor(image.storageKey));
        result.images.push({ type: 'image', data: bytes.toString('base64'), mimeType: image.mimeType });
        imageBytes += bytes.byteLength;
        result.manifests.push({
          attachmentId: item.id,
          name: item.name,
          detectedMediaType: item.detectedMediaType ?? image.mimeType,
          byteSize: item.byteSize,
          sha256: row.sha256,
          ...delivery,
          delivery: 'content-derived',
          contentAvailableToModel: true,
        });
        continue;
      }
      const manifestOnly = document === undefined;
      result.manifests.push({
        attachmentId: item.id,
        name: item.name,
        detectedMediaType: item.detectedMediaType ?? 'application/octet-stream',
        byteSize: item.byteSize,
        sha256: row.sha256,
        ...delivery,
        path: delivery.extractedPath ?? delivery.originalPath,
        coverage: item.coverage,
        delivery: manifestOnly ? 'manifest-only' : 'content-derived',
        contentAvailableToModel: !manifestOnly,
        artifactSchema: manifestOnly
          ? undefined
          : {
              name: 'StructuredDocumentV1',
              version: 1,
              kindPath: 'kind',
              contentPath: 'units[].text',
              locatorPath: 'units[].locator',
              truncatedPath: 'truncated',
              diagnosticsPath: 'diagnostics[]',
            },
      });
      if (!manifestOnly) {
        if (
          document !== undefined &&
          document.byteSize <= 256 * 1024 &&
          inlineCharacters < input.maxInlineCharacters
        ) {
          const parsed = JSON.parse(
            await readFile(this.blobs.resolveForProcessor(document.storageKey), 'utf8')
          ) as { units?: Array<{ text?: string }> };
          const text = (parsed.units ?? [])
            .map((unit) => unit.text ?? '')
            .join('\n')
            .slice(0, input.maxInlineCharacters - inlineCharacters);
          if (text !== '') {
            result.promptSuffix += `\n<attachment_content id="${item.id}">\n${escapeXml(text)}\n</attachment_content>`;
            inlineCharacters += text.length;
          }
        }
      }
    }
    result.promptSuffix += attachmentDeliveryPrompt(result.manifests);
    return result;
  }

  /**
   * Resolves an original Blob key through the repository's lower storage catalog.
   */
  #originalStorageKey(sha256: string): string {
    return `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
  }
}

/**
 * Requires the immutable Blob checksum before an original can be materialized.
 *
 * @param value Nullable repository Blob identity.
 * @returns Verified immutable Blob checksum.
 * @throws ApplicationError when the ready attachment lost its Blob reference.
 */
function requireBlobSha256(value: string | null): string {
  if (value === null) {
    throw new ApplicationError('ATTACHMENT_NOT_READY', 'Attachment Blob is unavailable.', {
      statusCode: 423,
      retryable: true,
    });
  }
  return value;
}
