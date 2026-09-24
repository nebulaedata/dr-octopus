/**
 * @author Codex
 * @description Persists opaque Composer attachment identities and display metadata per Workspace Session.
 */
import type { ComposerAttachmentViewModel } from '@/stores/session/type';

/**
 * Persists only opaque attachment identities and display metadata, never browser file bytes.
 *
 * @param workspaceId Workspace owning the draft.
 * @param sessionId Session owning the draft.
 * @param attachments Current Composer attachment projection.
 */
export function persistAttachmentDraft(
  workspaceId: string,
  sessionId: string,
  attachments: readonly ComposerAttachmentViewModel[]
): void {
  const key = attachmentDraftKey(workspaceId, sessionId);
  const durable = attachments
    .filter((item) => !item.id.startsWith('local-'))
    .map(({ id, name, byteSize, revision, status, uploadFingerprint }) => ({
      id,
      name,
      byteSize,
      revision,
      status,
      ...(uploadFingerprint === undefined ? {} : { uploadFingerprint }),
    }));
  if (durable.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(durable));
}

/**
 * Restores opaque IDs as processing tasks until the authoritative batch query responds.
 *
 * @param workspaceId Workspace owning the draft.
 * @param sessionId Session owning the draft.
 * @returns Corruption-tolerant attachment identities ready for server reconciliation.
 */
export function restoreAttachmentDraft(
  workspaceId: string,
  sessionId: string
): ComposerAttachmentViewModel[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(attachmentDraftKey(workspaceId, sessionId)) ?? '[]'
    ) as unknown;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((candidate) => {
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        typeof (candidate as Record<string, unknown>)['id'] !== 'string' ||
        typeof (candidate as Record<string, unknown>)['name'] !== 'string' ||
        typeof (candidate as Record<string, unknown>)['byteSize'] !== 'number' ||
        typeof (candidate as Record<string, unknown>)['revision'] !== 'number'
      ) {
        return [];
      }
      const item = candidate as {
        id: string;
        name: string;
        byteSize: number;
        revision: number;
        uploadFingerprint?: unknown;
      };
      return [
        {
          id: item.id,
          name: item.name,
          byteSize: item.byteSize,
          revision: item.revision,
          status: 'processing' as const,
          ...(typeof item.uploadFingerprint === 'string'
            ? { uploadFingerprint: item.uploadFingerprint }
            : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Scopes browser draft metadata to one Workspace Session.
 *
 * @param workspaceId Workspace owning the draft.
 * @param sessionId Session owning the draft.
 * @returns Stable browser-storage key for the attachment draft.
 */
function attachmentDraftKey(workspaceId: string, sessionId: string): string {
  return `octopus:attachment-draft:${workspaceId}:${sessionId}`;
}
