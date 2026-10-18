/**
 * @author Codex
 * @description Maps authoritative attachment metadata into the shared Composer attachment view.
 */
import type { AttachmentResourceDto } from '@octopus/shared/protocol/attachments';
import type { ComposerAttachmentViewModel } from '@/stores/session';

/**
 * Maps a monotonic Server resource into Composer state while retaining local-only identity.
 */
export function toComposerAttachment(
  resource: AttachmentResourceDto,
  localKey?: string,
  uploadFingerprint?: string,
  localImage?: File
): ComposerAttachmentViewModel {
  let status: 'failed' | 'ready' | 'rejected' | 'processing' | 'uploading';
  if (resource.status === 'initiated' || resource.status === 'uploading') {
    status = 'uploading';
  } else if (resource.status === 'verifying' || resource.status === 'processing') {
    status = 'processing';
  } else if (resource.status === 'deleted') {
    status = 'rejected';
  } else {
    status = resource.status;
  }
  const presentationKind =
    resource.presentationKind ?? (resource.declaredMediaType?.startsWith('image/') ? 'image' : undefined);
  const sourceRequired = status === 'uploading' && localKey === undefined && presentationKind === 'image';
  let error: ComposerAttachmentViewModel['error'] = resource.error;
  if (sourceRequired) {
    error = {
      code: 'UPLOAD_SOURCE_REQUIRED',
      message: 'Select the same image again to resume, or remove it and add a new image.',
      retryable: false,
    };
  }
  return {
    ...(localImage === undefined || resource.status === 'ready' ? {} : { localImage }),
    id: resource.id,
    ...(localKey === undefined ? {} : { localKey }),
    ...(uploadFingerprint === undefined ? {} : { uploadFingerprint }),
    name: resource.name,
    byteSize: resource.byteSize,
    coverage: resource.coverage,
    revision: resource.revision,
    status: sourceRequired ? 'failed' : status,
    ...(resource.detectedMediaType === undefined ? {} : { detectedMediaType: resource.detectedMediaType }),
    ...(presentationKind === undefined ? {} : { presentationKind }),
    ...(error === undefined ? {} : { error }),
  };
}
