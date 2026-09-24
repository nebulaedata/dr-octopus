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
  uploadFingerprint?: string
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
  return {
    id: resource.id,
    ...(localKey === undefined ? {} : { localKey }),
    ...(uploadFingerprint === undefined ? {} : { uploadFingerprint }),
    name: resource.name,
    byteSize: resource.byteSize,
    coverage: resource.coverage,
    revision: resource.revision,
    status,
    ...(resource.detectedMediaType === undefined ? {} : { detectedMediaType: resource.detectedMediaType }),
    ...(resource.presentationKind === undefined ? {} : { presentationKind: resource.presentationKind }),
    ...(resource.error === undefined ? {} : { error: resource.error }),
  };
}
