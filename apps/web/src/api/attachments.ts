/**
 * @author root
 * @description Implements tus browser upload/resume and attachment projection control-plane requests.
 */

import { Upload } from 'tus-js-client';
import { v4 as uuidv4 } from 'uuid';
import { request } from '../utils/request';
import type { AttachmentResourceDto } from '@octopus/shared/protocol/attachments';
import type { OctopusCapabilities } from '@octopus/shared/protocol';

export interface AttachmentUploadCallbacks {
  /**
   * Receives the durable Host identity as soon as tus creation succeeds.
   */
  onCreated(id: string): void;
  /**
   * Receives transient byte progress from the active tus request.
   */
  onProgress(uploadedBytes: number, totalBytes: number): void;
}

export interface AttachmentUploadTask {
  /**
   * Stable browser authorization fingerprint persisted beside the staged attachment ID.
   */
  fingerprint: string;
  /**
   * Resolves with the Server projection after upload finish.
   */
  result: Promise<AttachmentResourceDto>;
  /**
   * Cancels the active request and asks tus to terminate its server resource.
   */
  abort(): Promise<void>;
}

/**
 * Starts or resumes one tus upload while retaining browser fingerprint state.
 */
export function startAttachmentUpload(
  workspaceId: string,
  file: File,
  callbacks: AttachmentUploadCallbacks,
  chunkSize: number
): AttachmentUploadTask {
  const fingerprint = `octopus-${workspaceId}-${file.name}-${file.type}-${String(file.size)}-${String(file.lastModified)}`;
  let activeUpload: Upload | undefined;
  let restartedDeletedUpload = false;
  let resolveResult!: (value: AttachmentResourceDto) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<AttachmentResourceDto>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  /**
   * Starts one upload attempt, optionally consulting resumable browser state.
   *
   * @param allowResume Whether this attempt may reuse an unfinished tus URL.
   */
  function beginUpload(allowResume: boolean): void {
    let attachmentId: string | undefined;
    const upload = new Upload(file, {
      endpoint: `/api/workspaces/${encodeURIComponent(workspaceId)}/attachments/uploads`,
      chunkSize,
      retryDelays: [0, 1_000, 3_000, 5_000],
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      metadata: { filename: file.name, ...(file.type === '' ? {} : { declaredMediaType: file.type }) },
      headers: { 'Idempotency-Key': uuidv4() },
      fingerprint: async () => fingerprint,
      onAfterResponse(_request, response) {
        const id =
          response.getHeader('Upload-Attachment-Id') ?? response.getHeader('Location')?.split('/').at(-1);
        if (id !== undefined && attachmentId === undefined) {
          attachmentId = id;
          callbacks.onCreated(id);
        }
      },
      onProgress(bytesUploaded, bytesTotal) {
        callbacks.onProgress(bytesUploaded, bytesTotal);
      },
      onError(error) {
        rejectResult(error);
      },
      onSuccess() {
        const id = attachmentId ?? upload.url?.split('/').at(-1);
        if (id === undefined) {
          rejectResult(new Error('Upload completed without an attachment identity.'));
          return;
        }
        void getAttachment(workspaceId, id).then((resource) => {
          if (resource.status === 'deleted' && !restartedDeletedUpload) {
            restartedDeletedUpload = true;
            callbacks.onProgress(0, file.size);
            beginUpload(false);
            return;
          }
          resolveResult(resource);
        }, rejectResult);
      },
    });
    activeUpload = upload;
    if (!allowResume) {
      upload.start();
      return;
    }
    void upload.findPreviousUploads().then((previous) => {
      if (previous[0] !== undefined) {
        upload.resumeFromPreviousUpload(previous[0]);
      }
      upload.start();
    }, rejectResult);
  }

  beginUpload(true);
  return {
    fingerprint,
    result,
    abort: async () => {
      if (activeUpload !== undefined) {
        await activeUpload.abort(true);
      }
    },
  };
}

/**
 * Fetches Server capabilities, including the recommended tus transfer chunk size.
 */
export function getAttachmentCapabilities(signal?: AbortSignal): Promise<OctopusCapabilities> {
  return request({ url: '/capabilities', signal });
}

/**
 * Fetches one authoritative attachment projection.
 */
export function getAttachment(
  workspaceId: string,
  id: string,
  signal?: AbortSignal
): Promise<AttachmentResourceDto> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/attachments/${encodeURIComponent(id)}`,
    signal,
  });
}
/**
 * Fetches projections in caller order, splitting requests to respect the Server batch endpoint.
 */
export async function getAttachments(
  workspaceId: string,
  ids: readonly string[],
  signal?: AbortSignal
): Promise<{ items: AttachmentResourceDto[] }> {
  const items: AttachmentResourceDto[] = [];
  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = await request<{ items: AttachmentResourceDto[] }>({
      url: `/workspaces/${encodeURIComponent(workspaceId)}/attachments`,
      params: { ids: ids.slice(offset, offset + 10).join(',') },
      signal,
    });
    items.push(...batch.items);
  }
  return { items };
}
/**
 * Returns the stable same-origin content URL used by media and download actions.
 */
export function attachmentContentUrl(
  workspaceId: string,
  id: string,
  disposition: 'inline' | 'attachment' = 'inline'
): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/attachments/${encodeURIComponent(id)}/content?disposition=${disposition}`;
}

/**
 * Loads Host-authorized text content for a capability-gated attachment preview.
 */
export function getAttachmentPreviewContent(contentUrl: string, signal?: AbortSignal): Promise<string> {
  if (!contentUrl.startsWith('/api/workspaces/')) {
    return Promise.reject(new Error('Attachment preview URL is invalid.'));
  }
  return request({
    baseURL: '',
    url: contentUrl,
    responseType: 'text',
    headers: {
      Accept: 'text/markdown, text/plain;q=0.9, application/json;q=0.9, application/javascript;q=0.8',
    },
    signal,
  });
}
/**
 * Retries one retryable processing failure under revision CAS.
 */
export function retryAttachment(
  workspaceId: string,
  item: { id: string; revision: number }
): Promise<AttachmentResourceDto> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/attachments/${encodeURIComponent(item.id)}/retry`,
    method: 'POST',
    headers: { 'Idempotency-Key': uuidv4(), 'If-Match': `"attachment-${item.id}-r${String(item.revision)}"` },
    data: { expectedRevision: item.revision },
  });
}
/**
 * Deletes one staged resource under revision CAS while preserving message tombstones.
 */
export function deleteAttachment(
  workspaceId: string,
  item: { id: string; revision: number }
): Promise<AttachmentResourceDto> {
  return request({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/attachments/${encodeURIComponent(item.id)}`,
    method: 'DELETE',
    headers: { 'Idempotency-Key': uuidv4(), 'If-Match': `"attachment-${item.id}-r${String(item.revision)}"` },
    data: { expectedRevision: item.revision },
  });
}
