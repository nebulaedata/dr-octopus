/**
 * @author Codex
 * @description Owns draft submission, recovery and model intent before handing preparation to the Session route.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { ApiRequestError } from '@/utils/request';
import { getConversationModels, startConversation, getConversationStart } from '@/api/conversation-starts';
import { useHomeDrafts, emptyHomeDraft } from '@/stores/home-drafts';
import { useWorkbenchHome } from '@/stores/workbench-home';
import { sessionStores, persistAttachmentDraft } from '@/stores/session';
import { conversationStartReceiptOptions } from '@/queries/conversation-start-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { SessionDto, WorkspaceReferenceDto, ConversationStartInput } from '@octopus/shared/protocol';
import type { Snippet } from '@/stores/snippets';

/**
 * Preserves editing and request identity while exposing semantic recovery operations to the page.
 */
export function useHomeDraft(workspaceId: string, id: string, onSeparate: (id: string) => void) {
  const { t } = useI18n();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [conflict, setConflict] = useState(false);
  const [modelSetupRequest, setModelSetupRequest] = useState(0);
  const store = sessionStores.ensure(id);
  useEffect(() => () => sessionStores.markIdle(id), [id]);
  const [initialDraft] = useState(() => {
    const saved = useHomeDrafts.getState().drafts[id]?.editor;
    if (saved) {
      store.getState().setDraft(saved.text);
    }
    return saved ?? { text: store.getState().draft, references: [] };
  });
  const draft = useHomeDrafts((state) => state.drafts[id] ?? emptyHomeDraft);
  const error = useStore(store, (state) => state.error);
  const catalog = useQuery({
    queryKey: ['conversation-models'],
    queryFn: ({ signal }) => getConversationModels(signal),
  });
  const submission = draft.submission;
  const operationKey = ['conversation-start', workspaceId, submission?.submissionId];
  const operation = useQuery({
    queryKey: operationKey,
    queryFn: () => getConversationStart(workspaceId, submission!.submissionId),
    enabled: Boolean(submission),
    retry: false,
  });
  const status = operation.data?.status;
  const pending = Boolean(submission) && status !== 'failed' && status !== 'cancelled';
  useEffect(() => {
    if (!submission || !operation.data || ['failed', 'cancelled'].includes(operation.data.status)) {
      return;
    }
    const nextId = operation.data.sessionId;
    client.setQueryData(conversationStartReceiptOptions(workspaceId, nextId).queryKey, operation.data);
    void navigate({
      to: '/workspaces/$workspaceId/sessions/$sessionId',
      params: { workspaceId, sessionId: nextId },
      search: (previous) => previous,
    });
  }, [operation.data, submission, workspaceId, navigate, client]);
  const models = catalog.data?.models ?? [];
  const defaults = catalog.data?.defaults;
  const selected =
    draft.selection.mode === 'explicit'
      ? models.find(
          (model) =>
            model.provider === (draft.selection.mode === 'explicit' ? draft.selection.provider : '') &&
            model.id === (draft.selection.mode === 'explicit' ? draft.selection.modelId : '')
        )
      : (models.find((model) => model.provider === defaults?.providerId && model.id === defaults?.modelId) ??
        (!defaults?.configured && models.length === 1 ? models[0] : undefined));
  const session: SessionDto = {
    id,
    workspaceId,
    title: 'New session',
    isDraft: true,
    createdAt: '',
    updatedAt: '',
    preferences: {
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      autoCompactionEnabled: true,
      autoRetryEnabled: true,
    },
    ...(selected ? { provider: selected.provider, model: selected.id } : {}),
  };
  /**
   * Persists identity before sending; failed transport responses never create a different submission.
   */
  async function submit(
    message: string,
    attachmentIds: string[],
    workspaceReferences: WorkspaceReferenceDto[],
    snippet?: Snippet
  ) {
    if (!selected || catalog.isError) {
      requestModelSetup();
      return;
    }
    const current = useHomeDrafts.getState().drafts[id] ?? emptyHomeDraft;
    const request =
      current.submission && !['failed', 'cancelled'].includes(status ?? '')
        ? current.submission
        : {
            submissionId: uuidv4(),
            draftId: snippet ? uuidv4() : id,
            draftVersion: current.version,
            message,
            attachmentIds,
            workspaceReferences,
            selection: current.selection,
            controls: snippet
              ? { ...current.controls, workMode: snippet.workMode, knowledge: undefined }
              : current.controls,
          };
    store.getState().setError(undefined);
    useHomeDrafts.getState().submission(id, request);
    await post(request, !current.submission || ['failed', 'cancelled'].includes(status ?? ''));
  }
  /**
   * Uses an independent draft identity so quick starts never consume the composer's saved input or attachments.
   * Existing in-flight submissions retain their identity and cannot be replaced by a second card click.
   */
  async function submitSnippet(snippet: Snippet) {
    const current = useHomeDrafts.getState().drafts[id];
    if (current?.submission && !['failed', 'cancelled'].includes(status ?? '')) {
      return;
    }
    await submit(snippet.message, [], [], snippet);
  }
  /**
   * Adopts the winning operation when another tab submitted the identical draft first.
   */
  async function post(request: ConversationStartInput, newSubmission = false) {
    try {
      const result = await startConversation(workspaceId, request);
      setConflict(false);
      if (result.submissionId !== request.submissionId) {
        useHomeDrafts.getState().submission(id, { ...request, submissionId: result.submissionId });
      }
      client.setQueryData(['conversation-start', workspaceId, result.submissionId], result);
    } catch (failure) {
      setConflict(failure instanceof ApiRequestError && failure.code === 'CONVERSATION_START_CONFLICT');
      if (
        newSubmission &&
        failure instanceof ApiRequestError &&
        ['CONVERSATION_START_INVALID', 'CONVERSATION_START_CLOSED', 'SESSION_DRAFT_CAPACITY'].includes(
          failure.code
        )
      ) {
        // Only a fresh request can be released: rejection of a retry cannot disprove an earlier admission.
        const current = useHomeDrafts.getState().drafts[id];
        if (current?.submission?.submissionId === request.submissionId) {
          useHomeDrafts.getState().submission(id, undefined);
        }
      }
      store
        .getState()
        .setError(
          failure instanceof Error
            ? failure.message
            : t(
                'home.statusUnavailable',
                'Submission status is unavailable. Retry to check the same request.'
              )
        );
    }
  }
  /**
   * Keeps divergent tab input and attachments when the user explicitly starts a separate conversation.
   */
  function separateDraft() {
    const current = useHomeDrafts.getState().drafts[id] ?? emptyHomeDraft;
    const next = useWorkbenchHome.getState().renewDraftId(workspaceId, id);
    useHomeDrafts.getState().edit(next, current.editor);
    useHomeDrafts.getState().select(next, current.selection);
    useHomeDrafts.getState().controls(next, current.controls ?? {});
    persistAttachmentDraft(workspaceId, next, store.getState().attachments);
    onSeparate(next);
  }
  /**
   * Reopens model guidance on an explicit user action after it has been dismissed.
   */
  function requestModelSetup(): void {
    setModelSetupRequest((version) => version + 1);
  }
  return {
    modelSetupRequest,
    requestModelSetup,
    draft,
    error,
    catalog,
    submission,
    operation,
    pending,
    models,
    selected,
    session,
    initialDraft,
    submit,
    submitSnippet,
    post,
    separateDraft,
    conflict,
  };
}
