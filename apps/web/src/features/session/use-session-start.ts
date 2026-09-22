/**
 * @author Codex
 * @description Owns startup receipt reconciliation, cancellation and safe draft recovery on the Session route.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { cancelConversationStart } from '@/api/conversation-starts';
import { conversationStartReceiptOptions } from '@/queries/conversation-start-queries';
import { useHomeDrafts } from '@/stores/home-drafts';
import { useWorkbenchHome } from '@/stores/workbench-home';
import { recoverStartDraft } from './recover-start-draft';
import { useI18n } from '@/i18n/use-i18n';
import { persistAttachmentDraft } from '@/stores/session';

/**
 * Keeps preparation independent of Agent bootstrap and clears only an accepted local draft version.
 */
export function useSessionStart(workspaceId: string, sessionId: string, missing = false) {
  const { t } = useI18n();
  const client = useQueryClient();
  const navigate = useNavigate();
  const options = conversationStartReceiptOptions(workspaceId, sessionId);
  const receipt = useQuery(options);
  const data = receipt.data;
  const published = Boolean(data && ['accepted', 'dispatching', 'running', 'unknown'].includes(data.status));
  useEffect(() => {
    if (missing && published) {
      void client.invalidateQueries({ queryKey: ['sessions', workspaceId] });
    }
  }, [client, missing, published, receipt.dataUpdatedAt, workspaceId]);
  useEffect(() => {
    if (!data || !['accepted', 'dispatching', 'running', 'unknown'].includes(data.status)) {
      return;
    }
    const drafts = useHomeDrafts.getState();
    for (const [id, draft] of Object.entries(drafts.drafts)) {
      if (draft.submission?.submissionId !== data.submissionId) {
        continue;
      }
      drafts.accepted(id, draft.submission.draftVersion);
      if (draft.version === draft.submission.draftVersion) {
        if (useWorkbenchHome.getState().draftIds[workspaceId] === id) {
          useWorkbenchHome.getState().forgetDraft(workspaceId);
        }
        persistAttachmentDraft(workspaceId, id, []);
      }
    }
  }, [data, workspaceId]);
  const cancel = useMutation({
    mutationFn: () => cancelConversationStart(workspaceId, data!.submissionId),
    async onSuccess(result) {
      // Discard a pre-cancellation snapshot before committing the authoritative outcome.
      await client.cancelQueries({ queryKey: options.queryKey });
      client.setQueryData(options.queryKey, result);
      client.setQueryData(['conversation-start', workspaceId, result.submissionId], result);
    },
  });
  const recovery = useMutation({
    mutationFn: async () => {
      if (!data || !['failed', 'cancelled'].includes(data.status)) {
        return;
      }
      await recoverStartDraft(workspaceId, data, t);
    },
  });
  /**
   * Only a mounted route follows completed recovery; failures leave the authoritative receipt visible.
   */
  function recover() {
    recovery.mutate(undefined, {
      onSuccess: () =>
        void navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId },
          search: (previous) => previous,
        }),
    });
  }
  return { receipt, cancel, recover, recovery, workspaceId };
}
