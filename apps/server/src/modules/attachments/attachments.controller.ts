/**
 * @author root
 * @description Registers Workspace-scoped tus 1.0 upload and authorized attachment projection/content endpoints.
 * - OPTIONS /api/workspaces/:workspaceId/attachments/uploads
 * - POST /api/workspaces/:workspaceId/attachments/uploads
 * - HEAD /api/workspaces/:workspaceId/attachments/uploads/:uploadId
 * - PATCH /api/workspaces/:workspaceId/attachments/uploads/:uploadId
 * - DELETE /api/workspaces/:workspaceId/attachments/uploads/:uploadId
 * - GET /api/workspaces/:workspaceId/attachments
 * - GET /api/workspaces/:workspaceId/attachments/:id
 * - GET /api/workspaces/:workspaceId/attachments/:id/content
 * - GET /api/workspaces/:workspaceId/attachments/:id/preview
 * - POST /api/workspaces/:workspaceId/attachments/:id/retry
 * - DELETE /api/workspaces/:workspaceId/attachments/:id
 */

import {
  AttachmentErrorResponseJsonSchema,
  AttachmentListResponseJsonSchema,
  AttachmentMutationRequestJsonSchema,
  AttachmentResourceJsonSchema,
} from '@octopus/shared/protocol/attachments';
import { Server as TusServer } from '@tus/server';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { toPublicError } from '../../infrastructure/errors/public-error.js';
import { negotiateLocale } from '../../infrastructure/i18n/negotiate-locale.js';
import { registerErrorMessages } from '../../infrastructure/i18n/error-catalog.js';
import type { DataStore } from '@tus/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WorkspacesService } from '../workspaces/index.js';
import type { AttachmentsService } from './attachments.service.js';
import type { ErrorMessageCatalog } from '../../infrastructure/i18n/error-catalog.js';

interface WorkspaceParams {
  workspaceId: string;
}
interface AttachmentParams extends WorkspaceParams {
  id: string;
}
interface UploadParams extends WorkspaceParams {
  uploadId: string;
}
interface AttachmentListQuery {
  ids?: string;
}
interface ContentQuery {
  disposition?: 'inline' | 'attachment';
}

const attachmentErrors = {
  400: AttachmentErrorResponseJsonSchema,
  404: AttachmentErrorResponseJsonSchema,
  409: AttachmentErrorResponseJsonSchema,
  413: AttachmentErrorResponseJsonSchema,
  415: AttachmentErrorResponseJsonSchema,
  422: AttachmentErrorResponseJsonSchema,
  423: AttachmentErrorResponseJsonSchema,
  429: AttachmentErrorResponseJsonSchema,
  507: AttachmentErrorResponseJsonSchema,
};

/**
 * Registers binary transport separately from the JSON control-plane body parser.
 */
export function registerAttachmentsController(
  server: FastifyInstance,
  attachments: AttachmentsService,
  workspaces: WorkspacesService,
  datastore: DataStore
): void {
  if (!server.hasContentTypeParser('application/offset+octet-stream')) {
    server.addContentTypeParser('application/offset+octet-stream', (_request, _payload, done) => done(null));
  }
  server.setErrorHandler((error, request, reply) => {
    const projected = toPublicError(error, negotiateLocale(request.headers['accept-language']));
    request.log.warn({ requestId: request.id, code: projected.code }, 'Attachment request failed');
    reply.status(projected.statusCode).send({
      error: {
        code: projected.code,
        message: projected.message,
        retryable: projected.retryable,
        requestId: request.id,
      },
    });
  });
  const tus = new TusServer({
    path: '/api/workspaces',
    datastore,
    maxSize: attachments.maxBytes,
    relativeLocation: true,
    disableTerminationForFinishedUploads: true,
    allowedHeaders: ['Idempotency-Key'],
    exposedHeaders: ['Location', 'Tus-Resumable', 'Upload-Expires', 'Upload-Offset', 'Upload-Attachment-Id'],
    namingFunction: () => randomUUID(),
    generateUrl: (request, options) => `${new URL(request.url).pathname.replace(/\/$/, '')}/${options.id}`,
    onUploadCreate: async (request, upload) => {
      const workspaceId = workspaceFromUrl(request.url);
      await workspaces.resolve({ id: workspaceId });
      const idempotencyKey = request.headers.get('idempotency-key');
      if (idempotencyKey === null || !UUID.test(idempotencyKey)) {
        throw invalid('Idempotency-Key must be a UUID.');
      }
      const metadata = upload.metadata ?? {};
      if (Object.keys(metadata).some((key) => key !== 'filename' && key !== 'declaredMediaType')) {
        throw invalid('Upload metadata contains an unsupported key.');
      }
      const rawName = metadata['filename'];
      if (rawName === null || rawName === undefined) {
        throw invalid('Upload filename metadata is required.');
      }
      const filename = normalizeFilename(rawName);
      const declaredMediaType = metadata['declaredMediaType'];
      if (declaredMediaType !== null && declaredMediaType !== undefined && declaredMediaType.length > 127) {
        throw invalid('Declared media type is too long.');
      }
      if (upload.size === undefined) {
        throw invalid('Deferred upload length is not supported.');
      }
      await attachments.assertUploadCapacity(workspaceId, 'local-host-user', upload.size);
      return {
        metadata: {
          filename,
          declaredMediaType: declaredMediaType ?? null,
          octopusWorkspaceId: workspaceId,
          octopusOwnerId: 'local-host-user',
          octopusIdempotencyKey: idempotencyKey,
        },
      };
    },
    onUploadFinish: async (_request, upload) => {
      await attachments.finalize(upload.id);
      return { headers: { 'Upload-Attachment-Id': upload.id } };
    },
    onResponseError: (_request, error) => {
      if (error instanceof ApplicationError) {
        return {
          status_code: error.statusCode,
          body: JSON.stringify({
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              requestId: randomUUID(),
            },
          }),
        };
      }
      return undefined;
    },
  });

  server.route<{ Params: WorkspaceParams }>({
    method: ['OPTIONS', 'POST'],
    url: '/workspaces/:workspaceId/attachments/uploads',
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (request, reply) => handleTus(tus, request, reply),
  });
  server.route<{ Params: UploadParams }>({
    method: ['OPTIONS', 'HEAD', 'PATCH', 'DELETE'],
    url: '/workspaces/:workspaceId/attachments/uploads/:uploadId',
    bodyLimit: 16 * 1024 * 1024,
    preHandler: async (request) => {
      await workspaces.resolve({ id: request.params.workspaceId });
      if (request.method !== 'OPTIONS') {
        attachments.assertUploadWorkspace(request.params.workspaceId, request.params.uploadId);
      }
    },
    handler: async (request, reply) => handleTus(tus, request, reply),
  });

  server.get<{ Params: WorkspaceParams; Querystring: AttachmentListQuery }>(
    '/workspaces/:workspaceId/attachments',
    { schema: { response: { 200: AttachmentListResponseJsonSchema, ...attachmentErrors } } },
    async (request, reply) => {
      await workspaces.resolve({ id: request.params.workspaceId });
      const ids = request.query.ids?.split(',').filter(Boolean) ?? [];
      reply.header('cache-control', 'no-store');
      return { items: attachments.list(request.params.workspaceId, ids) };
    }
  );
  server.get<{ Params: AttachmentParams }>(
    '/workspaces/:workspaceId/attachments/:id',
    { schema: { response: { 200: AttachmentResourceJsonSchema, ...attachmentErrors } } },
    async (request, reply) => {
      await workspaces.resolve({ id: request.params.workspaceId });
      const dto = attachments.get(request.params.workspaceId, request.params.id);
      reply.header('cache-control', 'no-store').header('etag', etag(dto.id, dto.revision));
      return dto;
    }
  );
  server.get<{ Params: AttachmentParams; Querystring: ContentQuery }>(
    '/workspaces/:workspaceId/attachments/:id/content',
    async (request, reply) => {
      await workspaces.resolve({ id: request.params.workspaceId });
      const current = attachments.get(request.params.workspaceId, request.params.id);
      let range: { start: number; end: number } | undefined;
      try {
        range = parseRange(request.headers.range, current.byteSize);
      } catch (error) {
        reply.header('content-range', `bytes */${String(current.byteSize)}`);
        throw error;
      }
      const { dto, read } = await attachments.openContent(
        request.params.workspaceId,
        request.params.id,
        range
      );
      applyContentHeaders(
        reply,
        dto.detectedMediaType ?? 'application/octet-stream',
        dto.name,
        dto.sha256,
        request.query.disposition ?? 'inline',
        read.byteSize,
        read.start,
        read.end,
        range !== undefined
      );
      return reply.send(read.stream);
    }
  );
  server.get<{ Params: AttachmentParams }>(
    '/workspaces/:workspaceId/attachments/:id/preview',
    async (request, reply) => {
      await workspaces.resolve({ id: request.params.workspaceId });
      const { derivative, read } = await attachments.openPreview(
        request.params.workspaceId,
        request.params.id
      );
      applyContentHeaders(
        reply,
        derivative.mimeType,
        'preview',
        derivative.sha256,
        'inline',
        read.byteSize,
        read.start,
        read.end,
        false
      );
      return reply.send(read.stream);
    }
  );
  server.post<{ Params: AttachmentParams; Body: { expectedRevision: number } }>(
    '/workspaces/:workspaceId/attachments/:id/retry',
    {
      bodyLimit: 64 * 1024,
      schema: {
        body: AttachmentMutationRequestJsonSchema,
        response: { 202: AttachmentResourceJsonSchema, ...attachmentErrors },
      },
    },
    async (request, reply) => {
      await workspaces.resolve({ id: request.params.workspaceId });
      const key = requireIdempotencyKey(request.headers['idempotency-key']);
      requireIfMatch(request.headers['if-match'], request.params.id, request.body.expectedRevision);
      const dto = await attachments.retry(
        request.params.workspaceId,
        request.params.id,
        request.body.expectedRevision,
        key
      );
      reply.status(202).header('cache-control', 'no-store').header('etag', etag(dto.id, dto.revision));
      return dto;
    }
  );
  server.delete<{ Params: AttachmentParams; Body: { expectedRevision: number } }>(
    '/workspaces/:workspaceId/attachments/:id',
    {
      bodyLimit: 64 * 1024,
      schema: {
        body: AttachmentMutationRequestJsonSchema,
        response: { 202: AttachmentResourceJsonSchema, ...attachmentErrors },
      },
    },
    async (request, reply) => {
      await workspaces.resolve({ id: request.params.workspaceId });
      const key = requireIdempotencyKey(request.headers['idempotency-key']);
      requireIfMatch(request.headers['if-match'], request.params.id, request.body.expectedRevision);
      const dto = await attachments.delete(
        request.params.workspaceId,
        request.params.id,
        request.body.expectedRevision,
        key
      );
      reply.status(202).header('cache-control', 'no-store').header('etag', etag(dto.id, dto.revision));
      return dto;
    }
  );

  server.addHook('onClose', () => attachments.close());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * Hands the raw Node request to @tus/server and prevents Fastify from serializing a second response.
 */
async function handleTus(tus: TusServer, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.hijack();
  await tus.handle(request.raw, reply.raw);
}
/**
 * Extracts the Workspace identity from the fixed tus route.
 */
function workspaceFromUrl(value: string): string {
  const match = new URL(value).pathname.match(/\/api\/workspaces\/([^/]+)\/attachments\/uploads/);
  if (match?.[1] === undefined) {
    throw invalid('Upload Workspace path is invalid.');
  }
  return decodeURIComponent(match[1]);
}
/**
 * Normalizes display-only filenames without allowing controls or path semantics.
 */
function normalizeFilename(value: string): string {
  const normalized = [...value.normalize('NFC')]
    .filter(
      (character) => character >= ' ' && character !== '\u007f' && character !== '/' && character !== '\\'
    )
    .slice(0, 255)
    .join('');
  if (normalized.length === 0) {
    throw invalid('Upload filename is invalid.');
  }
  return normalized;
}
/**
 * Parses one inclusive byte range and rejects multi-range or unsatisfiable requests.
 */
function parseRange(value: string | undefined, size: number): { start: number; end: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = value.match(/^bytes=(\d+)-(\d*)$/);
  if (match === null) {
    throw new ApplicationError('ATTACHMENT_REQUEST_INVALID', 'Only one explicit byte range is supported.', {
      statusCode: 416,
    });
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= size) {
    throw new ApplicationError('ATTACHMENT_REQUEST_INVALID', 'Requested byte range is unsatisfiable.', {
      statusCode: 416,
    });
  }
  return { start, end };
}
/**
 * Applies nosniff, sandboxing, Range, ETag, and RFC 5987 content disposition headers.
 */
function applyContentHeaders(
  reply: FastifyReply,
  mime: string,
  name: string,
  sha256: string | undefined,
  disposition: 'inline' | 'attachment',
  size: number,
  start: number,
  end: number,
  partial: boolean
): void {
  reply
    .status(partial ? 206 : 200)
    .type(mime)
    .header('accept-ranges', 'bytes')
    .header('content-length', String(end - start + 1))
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "sandbox; default-src 'none'; media-src 'self'; img-src 'self'")
    .header('content-disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`);
  if (sha256 !== undefined) {
    reply.header('etag', `"sha256-${sha256}"`);
  }
  if (partial) {
    reply.header('content-range', `bytes ${start}-${end}/${size}`);
  }
}
/**
 * Formats the revision CAS token.
 */
function etag(id: string, revision: number): string {
  return `"attachment-${id}-r${String(revision)}"`;
}
/**
 * Creates a transport-safe invalid tus request.
 */
function invalid(message: string): ApplicationError {
  return new ApplicationError('ATTACHMENT_REQUEST_INVALID', message, { statusCode: 400, retryable: false });
}
/**
 * Requires the UUID idempotency header used by attachment mutations.
 */
function requireIdempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw invalid('Idempotency-Key must be a UUID.');
  }
  return value;
}
/**
 * Requires the exact revision ETag to fence retry and delete mutations.
 */
function requireIfMatch(value: string | string[] | undefined, id: string, revision: number): void {
  if (value !== etag(id, revision)) {
    throw new ApplicationError(
      'ATTACHMENT_STATE_CONFLICT',
      'If-Match does not match the expected attachment revision.',
      { statusCode: 409, retryable: true }
    );
  }
}

/**
 * Attachment-domain message variants keyed by stable error code.
 */
export const attachmentErrorMessages: ErrorMessageCatalog = {
  ATTACHMENT_NOT_FOUND: [
    { en: 'The attachment was not found.', 'zh-CN': '附件不存在或已被删除。' },
    {
      match: '附件原文不可用',
      en: 'The attachment content is unavailable.',
      'zh-CN': '附件原文不可用',
    },
  ],
  ATTACHMENT_NOT_READY: [
    { en: 'The attachment is not ready yet.', 'zh-CN': '附件尚未准备好。' },
    {
      match: '附件原文尚未准备好',
      en: 'The attachment content is not ready yet.',
      'zh-CN': '附件原文尚未准备好',
    },
  ],
};

/**
 * Merges the attachment-domain catalog into the shared error-message registry at Server boot.
 */
export function registerAttachmentErrorMessages(): void {
  registerErrorMessages('attachments', attachmentErrorMessages);
}
