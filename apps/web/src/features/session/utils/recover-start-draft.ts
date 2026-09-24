/**
 * @author Codex
 * @description Restores definitive startup failures without overwriting newer input or dropping source and attachment context.
 */
import { getAttachments } from '@/api/attachments';
import { restoreComposerDraft } from '@/components/AgentComposerEditor/restore-draft';
import { useHomeDrafts } from '@/stores/home-drafts';
import { useWorkbenchHome } from '@/stores/workbench-home';
import { sessionStores, restoreAttachmentDraft, persistAttachmentDraft } from '@/stores/session';
import { toComposerAttachment } from '@/features/session/utils/attachment-projection';
import type { ConversationStartDto } from '@octopus/shared/protocol';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Rechecks draft ownership after attachment I/O; mutations occur only after recovery can complete.
 */
export async function recoverStartDraft(
  workspaceId: string,
  receipt: ConversationStartDto,
  t: Translate
): Promise<void> {
  if (!['failed', 'cancelled'].includes(receipt.status)) {
    throw new Error('Accepted submissions cannot be restored for replay.');
  }
  const saved = Object.entries(useHomeDrafts.getState().drafts).find(
    ([, draft]) => draft.submission?.submissionId === receipt.submissionId
  );
  const request = receipt.draft;
  const id = saved?.[0] ?? request?.draftId ?? useWorkbenchHome.getState().ensureDraftId(workspaceId);
  const resources =
    !saved && request?.attachmentIds.length
      ? await getAttachments(workspaceId, request.attachmentIds)
      : undefined;
  if (
    resources &&
    request?.attachmentIds.some((attachmentId) => !resources.items.some((item) => item.id === attachmentId))
  ) {
    throw new Error(
      t(
        'session.startAttachmentsUnavailable',
        'Some saved attachments are unavailable. Your original submission is still saved.'
      )
    );
  }
  const currentId = useWorkbenchHome.getState().draftIds[workspaceId];
  for (const candidate of new Set([id, currentId].filter((value): value is string => Boolean(value)))) {
    const draft = useHomeDrafts.getState().drafts[candidate];
    if (candidate === saved?.[0] && draft?.submission?.submissionId === receipt.submissionId) {
      continue;
    }
    const hasInput =
      draft?.editor.text ||
      draft?.submission ||
      sessionStores.ensure(candidate).getState().draft ||
      sessionStores.ensure(candidate).getState().attachments.length ||
      restoreAttachmentDraft(workspaceId, candidate).length;
    if (hasInput) {
      throw new Error(
        t(
          'session.startDraftConflict',
          'Another draft already contains input. Finish or clear it before restoring this message.'
        )
      );
    }
  }
  const drafts = useHomeDrafts.getState();
  if (saved) {
    drafts.submission(id, undefined);
  } else {
    drafts.edit(
      id,
      restoreComposerDraft(
        receipt.message,
        (request?.workspaceReferences ?? []).map((reference) => ({ ...reference, label: reference.path }))
      )
    );
    if (request) {
      drafts.select(id, request.selection);
      drafts.controls(id, request.controls ?? {});
    }
    const attachments = resources?.items.map((resource) => toComposerAttachment(resource)) ?? [];
    sessionStores.ensure(id).getState().setAttachments(attachments);
    persistAttachmentDraft(workspaceId, id, attachments);
  }
  useWorkbenchHome.getState().resumeDraft(workspaceId, id);
}
