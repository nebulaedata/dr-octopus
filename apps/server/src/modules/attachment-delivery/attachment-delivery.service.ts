/**
 * @author root
 * @description Adapts ready Host attachments to bounded Pi inputs and Workspace-local originals, extracted artifacts, and explicit coverage notices.
 */

import {
  createAttachmentCapabilityResolver,
  DEFAULT_ATTACHMENT_POLICY,
} from '../../infrastructure/attachment-capability/index.js';
import { readFile } from 'node:fs/promises';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { attachmentDeliveryPrompt, escapeXml } from './attachment-delivery.utils.js';
import { WorkspaceAttachmentCache } from './attachment-delivery.repository.js';
import { deliverWorkspaceAttachment } from './attachment-delivery.repository.js';
export type { ResolvedAgentAttachments } from './attachment-delivery.dto.js';
import type { AttachmentResourceDto } from '@octopus/shared/protocol/attachments';
import type { LocalFileBlobStore } from '../../infrastructure/attachment-storage/local-file-blob-store.js';
import type { ResolvedAgentAttachments } from './attachment-delivery.dto.js';
import type { AttachmentsService } from '../attachments/index.js';

/**
 * Applies model and prompt budgets without extending Pi's public RPC contract.
 */
export class AttachmentDeliveryService {
  private readonly workspaceCache: WorkspaceAttachmentCache;

  /**
   * @param repository Attachment and derivative metadata authority.
   * @param blobs Immutable byte authority.
   */
  public constructor(
    private readonly attachments: Pick<
      AttachmentsService,
      | 'getDeliveryRecord'
      | 'getDeliveryDerivative'
      | 'searchDeliveryChunks'
      | 'auditAgentDelivery'
      | 'maxBytes'
    >,
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
      const row = this.attachments.getDeliveryRecord(item.id);
      if (row === undefined || row.status !== 'ready' || row.sha256 === null) {
        throw new ApplicationError('ATTACHMENT_NOT_READY', 'Attachment is not ready for the Agent.', {
          statusCode: 423,
          retryable: true,
        });
      }
      const document =
        item.classification === 'extractable-document'
          ? this.attachments.getDeliveryDerivative(item.id, 'document-json')
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
        const image = this.attachments.getDeliveryDerivative(item.id, 'model-image');
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

  /**
   * Resolves a reserved ready list to Pi's public text/image contract and managed global files.
   */
  public async resolveForAgent(
    items: readonly AttachmentResourceDto[],
    input: {
      modelInputs: ReadonlySet<'text' | 'image'>;
      maxInlineCharacters: number;
      provider?: string;
      modelId?: string;
      sessionId: string;
      workspaceCwd: string;
      requestId: string;
      queryText: string;
    }
  ) {
    for (const item of items) {
      const row = this.attachments.getDeliveryRecord(item.id);
      if (row?.evidence_json === null || row?.evidence_json === undefined) {
        throw new ApplicationError('ATTACHMENT_PROCESSING_FAILED', 'Attachment evidence is unavailable.', {
          statusCode: 422,
        });
      }
      const evidence = JSON.parse(row.evidence_json) as Parameters<
        ReturnType<typeof createAttachmentCapabilityResolver>['resolve']
      >[0];
      const resolution = createAttachmentCapabilityResolver().resolve(evidence, {
        processors: new Set([
          'image-optimize',
          'pdf-text-extract',
          'office-text-extract',
          'archive-text-extract',
          'spreadsheet-structure-extract',
          'full-text-index',
        ]),
        retrieval: new Set(['structured-file-read', 'lexical-search']),
        tools: new Set(['read-file']),
        agent: {
          modelInputs: input.modelInputs,
          maxContextCharacters: input.maxInlineCharacters,
        },
        policy: { ...DEFAULT_ATTACHMENT_POLICY, maxAttachmentBytes: this.attachments.maxBytes },
      });
      if (resolution.decision !== 'allow') {
        throw new ApplicationError(
          'ATTACHMENT_TYPE_UNSUPPORTED',
          'Attachment cannot be delivered to the active model.',
          { statusCode: 422 }
        );
      }
    }
    const adapted = await this.resolve(items, input);
    const searchQuery = ftsQuery(input.queryText);
    if (searchQuery !== '') {
      const hits = this.attachments.searchDeliveryChunks(
        items.map((item) => item.id),
        searchQuery,
        8
      );
      if (hits.length > 0) {
        adapted.promptSuffix += `\n<attachment_search_hits trust="untrusted-user-content">\n${hits.map((hit) => `  <hit attachment_id="${hit.attachmentId}" locator="${escapeAttribute(JSON.stringify(hit.locator))}">${escapeText(hit.text.slice(0, 1_000))}</hit>`).join('\n')}\n</attachment_search_hits>`;
      }
    }
    this.attachments.auditAgentDelivery({
      attachmentIds: items.map((item) => item.id),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      sessionId: input.sessionId,
      requestId: input.requestId,
    });
    return adapted;
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

/**
 * Converts user prose into a bounded literal-token FTS5 query.
 */
function ftsQuery(value: string): string {
  return [
    ...new Set(
      value
        .normalize('NFKC')
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]{2,32}/gu) ?? []
    ),
  ]
    .slice(0, 8)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' OR ');
}

/**
 * Escapes an untrusted value used in XML-like prompt attributes.
 */
function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

/**
 * Escapes untrusted extracted content so it cannot close Host prompt boundaries.
 */
function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
