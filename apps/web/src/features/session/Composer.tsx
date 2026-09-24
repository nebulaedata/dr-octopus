/**
 * @author Codex
 * @description Orchestrates Lexical drafting, Workspace references, commands, attachments, Agent controls, and realtime prompt routing.
 */

import { useEffect, useRef, useState } from 'react';
import { useMemoizedFn } from 'ahooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { v4 as uuidv4 } from 'uuid';
import { ArrowUpIcon, AtSignIcon, PaperclipIcon, SquareSlashIcon, TargetIcon } from 'lucide-react';
import { useStore } from 'zustand';
import { MAX_WORKSPACE_REFERENCES } from '@octopus/shared/protocol';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { getAttachmentCapabilities, startAttachmentUpload } from '@/api/attachments';
import { queryKeys } from '@/queries/core/query-keys';
import { useDeriveSession } from '@/queries/session-queries';
import { useRenameSession } from '@/queries/workbench-queries';
import { useRealtimeCommand } from '@/hooks/use-realtime';
import { useI18n } from '@/i18n/use-i18n';
import { useWorkbenchHome } from '@/stores/workbench-home';
import { persistAttachmentDraft, restoreAttachmentDraft, sessionStores } from '@/stores/session';
import { Upload } from '@/components/Upload';
import { download } from '@/utils/common';
import { realtimeClient } from '@/lib/runtime/realtime-client';
import { awaitRealtimeCommand } from '@/lib/runtime/await-realtime-command';
import { getSessionExportUrl } from '@/api/sessions';
import { AgentComposerEditor } from '@/components/AgentComposerEditor';
import { comboMatches, ShortcutKeyRegister, toAriaKeyShortcuts } from '@/lib/shortcuts';
import { useShortcut, useShortcutBinding } from '@/hooks/use-shortcut';
import { toComposerAttachment } from '@/features/session/utils/attachment-projection';
import { ComposerAttachments } from './ComposerAttachments';
import { RunningMessageControls } from './RunningMessageControls';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { ModelThinkingSelect } from './ModelThinkingSelect';
import { PermissionSelect } from './PermissionSelect';
import { KnowledgeModeBar } from './KnowledgeModeBar';
import { WorkModeSelect } from './WorkModeSelect';
import { RenameSessionDialog } from './RenameSessionDialog';
import { PlanModeExitDialog } from './PlanModeExitDialog';
import { ExtensionDialogHost } from './ExtensionDialogHost';
import { useComposerReferences } from './hooks/use-composer-references';
import { registerAttachmentUploadTask, unregisterAttachmentUploadTask } from '@/stores/session';
import { toWorkspaceReferences } from '@/features/session/utils/workspace-reference-payload';
import type { WorkspaceReferenceDto, DraftControls } from '@octopus/shared/protocol';
import type { KnowledgeModeState, KnowledgeModeConfig } from '@octopus/shared/protocol/knowledge';
import type { CommandDto, ModelDto, SessionDto, ThinkingLevel } from '@octopus/shared/protocol';
import type { PermissionMode } from '@octopus/shared/protocol';
import type { AgentComposerEditorHandle } from '@/components/AgentComposerEditor';
import type { ComposerCommand, ComposerDraft } from '@/components/AgentComposerEditor/types';
import type { RunningMessageMode } from './RunningMessageControls';
import type { AgentWorkMode } from './WorkModeSelect';
import type { ComposerAttachmentViewModel, SessionStoreApi } from '@/stores/session';

export interface ComposerProps {
  initialDraft?: ComposerDraft;
  followDefaultModel?: boolean;
  modelMenuOpen?: boolean;
  /**
   * Controls model-menu visibility from the home guidance dialog.
   */
  onModelMenuOpenChange?(open: boolean): void;
  /**
   * Restores default-model intent without changing an established Session.
   */
  onFollowDefaultModel?(): void;
  /**
   * Opens configuration guidance when no model choices are available.
   */
  onModelConfigurationNeeded?(): void;
  draftControls?: DraftControls;
  /**
   * Updates desired first-turn preferences without sending RPC commands.
   */
  onDraftControlsChange?(controls: DraftControls): void;
  /**
   * Persists local editing without coupling generic editor components to stores.
   */
  onDraftChange?(draft: ComposerDraft): void;
  /**
   * Selects an unstarted draft model without a runtime command.
   */
  onDraftModelChange?(value: string): void;
  /**
   * Submits the first message through the Host-owned admission boundary.
   */
  onFirstSubmit?(text: string, attachmentIds: string[], references: WorkspaceReferenceDto[]): Promise<void>;
  firstSubmitPending?: boolean;
  variant?: 'home' | 'conversation';
  /**
   * Overrides the editor hint for route-specific transient states.
   */
  placeholder?: string;
  /**
   * Navigates after the first prompt has been dispatched using the existing runtime identity.
   */
  onPromptSubmitted?(): void;
  commands: CommandDto[];
  /**
   * Blocks message submission without changing editor or toolbar availability.
   */
  submitDisabled?: boolean;
  /**
   * Shows connection progress inside the existing submit button.
   */
  connecting?: boolean;
  models: ModelDto[];
  session: SessionDto;
}

/**
 * Routes settled prompts and running steer/follow-up messages through the realtime interface.
 */
export function Composer({
  commands,
  submitDisabled = false,
  connecting = false,
  models,
  session,
  variant = 'conversation',
  initialDraft,
  followDefaultModel,
  modelMenuOpen,
  onModelMenuOpenChange,
  onFollowDefaultModel,
  onModelConfigurationNeeded,
  draftControls,
  onDraftControlsChange,
  onDraftChange,
  onDraftModelChange,
  onFirstSubmit,
  firstSubmitPending = false,
  onPromptSubmitted,
  placeholder: placeholderOverride,
}: ComposerProps) {
  const { t } = useI18n();
  const sessionId = session.id;
  const store = sessionStores.ensure(sessionId);
  const draft = useStore(store, (state) => state.draft);
  const runtimeId = useStore(store, (state) => state.runtimeId);
  const epoch = useStore(store, (state) => state.epoch);
  const runtimeState = useStore(store, (state) => state.runtimeState);
  const submitting = useStore(store, (state) => state.pendingUserRequestIds.length > 0);
  const attachmentsReady = useStore(store, (state) =>
    state.attachments.every((item) => item.status === 'ready')
  );
  const attachmentDraftSignature = useStore(store, (state) =>
    JSON.stringify(
      state.attachments.map((item) => [item.id, item.name, item.byteSize, item.revision, item.status])
    )
  );
  const followUpCount = useStore(store, (state) => state.queue.followUp.length);
  const contextUsage = useStore(store, (state) => state.contextUsage);
  const thinking = useStore(store, (state) => state.thinking);
  const permissionMode = useStore(store, (state) => state.permission.mode);
  const planMode = useStore(store, (state) => state.planMode);
  const pendingWorkMode = useStore(store, (state) => state.pendingWorkMode);
  const running = runtimeState === 'running';
  const navigate = useNavigate();
  const sendBinding = useShortcutBinding(ShortcutKeyRegister.SEND_MESSAGE);
  const newlineBinding = useShortcutBinding(ShortcutKeyRegister.INSERT_NEWLINE);
  let sendButtonTitle: string | undefined;
  if (sendBinding !== null && newlineBinding !== null) {
    sendButtonTitle = t(
      'session.composer.submitAndNewlineHint',
      '{{send}} to submit, {{newline}} for a new line',
      {
        send: sendBinding.replaceAll('+', ' + '),
        newline: newlineBinding.replaceAll('+', ' + '),
      }
    );
  } else if (sendBinding !== null) {
    sendButtonTitle = t('session.composer.submitHint', '{{send}} to submit', {
      send: sendBinding.replaceAll('+', ' + '),
    });
  } else if (newlineBinding !== null) {
    sendButtonTitle = t('session.composer.newlineHint', '{{newline}} for a new line', {
      newline: newlineBinding.replaceAll('+', ' + '),
    });
  } else {
    sendButtonTitle = undefined;
  }
  const keyShortcutsHint = [
    sendBinding === null ? null : toAriaKeyShortcuts(sendBinding),
    sendBinding === null || sendBinding.includes('Alt+') ? null : `Alt+${toAriaKeyShortcuts(sendBinding)}`,
    newlineBinding === null ? null : toAriaKeyShortcuts(newlineBinding),
  ]
    .filter((token): token is string => token !== null)
    .join(' ');
  const [runningMessageMode, setRunningMessageMode] = useState<RunningMessageMode>('steer');
  const [planExitOpen, setPlanExitOpen] = useState(false);
  const [exitTarget, setExitTarget] = useState<AgentWorkMode>('agent');
  const [localModelOpen, setLocalModelOpen] = useState(false);
  const modelOpen = modelMenuOpen ?? localModelOpen;
  /**
   * Routes an empty catalog to actionable guidance instead of opening an empty menu.
   */
  function setModelOpen(open: boolean): void {
    if (open && models.length === 0 && onModelConfigurationNeeded) {
      onModelConfigurationNeeded();
      return;
    }
    (onModelMenuOpenChange ?? setLocalModelOpen)(open);
  }
  const [renameOpen, setRenameOpen] = useState(false);
  const attachmentDraftHydratedKeyRef = useRef<string | undefined>(undefined);
  const draftRef = useRef<ComposerDraft>(initialDraft ?? { text: draft, references: [] });
  const editorRef = useRef<AgentComposerEditorHandle>(null);
  const send = useRealtimeCommand();
  const queryClient = useQueryClient();
  const attachmentCapabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => getAttachmentCapabilities(signal),
    staleTime: 5 * 60_000,
  });
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const interactionDisabled = publishing || firstSubmitPending;
  const sendingDisabled = submitDisabled || interactionDisabled || pendingWorkMode !== undefined;
  const controlsLoaded = Boolean(onFirstSubmit) || (runtimeId !== undefined && epoch !== undefined);
  const workMode = draftControls?.workMode ?? planMode.workMode;
  const knowledgeState: KnowledgeModeState | undefined = onDraftControlsChange
    ? {
        version: 1,
        enabled: workMode === 'knowledge',
        collectionIds: draftControls?.knowledge?.collectionIds ?? [],
      }
    : planMode.knowledge;
  const references = useComposerReferences(session.workspaceId);
  const modelValue = session.model === undefined ? null : `${session.provider ?? ''}/${session.model}`;
  const deriveSession = useDeriveSession(session);
  const renameSession = useRenameSession();
  const attachmentDraftKey = `${session.workspaceId}:${sessionId}`;

  useEffect(() => {
    const restored = restoreAttachmentDraft(session.workspaceId, sessionId);
    if (store.getState().attachments.length === 0 && restored.length > 0) {
      store.getState().setAttachments(restored);
    }
    attachmentDraftHydratedKeyRef.current = attachmentDraftKey;
  }, [attachmentDraftKey, session.workspaceId, sessionId, store]);

  useEffect(() => {
    if (attachmentDraftHydratedKeyRef.current !== attachmentDraftKey) {
      return;
    }
    persistAttachmentDraft(session.workspaceId, sessionId, store.getState().attachments);
  }, [attachmentDraftKey, attachmentDraftSignature, session.workspaceId, sessionId, store]);

  /**
   * Stages selected browser files in order and stores only their opaque references.
   */
  const attach = useMemoizedFn(async (files: File[]): Promise<void> => {
    if (interactionDisabled || files.length === 0) {
      return;
    }
    try {
      for (const file of files) {
        const localId = `local-${uuidv4()}`;
        store.getState().setAttachments([
          ...store.getState().attachments,
          {
            id: localId,
            localKey: localId,
            name: file.name,
            byteSize: file.size,
            revision: 0,
            status: 'uploading',
            progress: { uploadedBytes: 0, totalBytes: file.size, percentage: 0 },
          },
        ]);
        const task = startAttachmentUpload(
          session.workspaceId,
          file,
          {
            onCreated(id) {
              updateComposerAttachment(store, localId, (item) => ({ ...item, id }));
            },
            onProgress(uploadedBytes, totalBytes) {
              updateComposerAttachment(store, localId, (item) => ({
                ...item,
                progress: {
                  uploadedBytes,
                  totalBytes,
                  percentage: totalBytes === 0 ? 0 : Math.round((uploadedBytes / totalBytes) * 100),
                },
              }));
            },
          },
          attachmentCapabilities.data?.limits.tusChunkBytes ?? 8 * 1024 * 1024
        );
        updateComposerAttachment(store, localId, (item) => ({
          ...item,
          uploadFingerprint: task.fingerprint,
        }));
        registerAttachmentUploadTask(localId, task);
        void task.result
          .then(
            (resource) =>
              updateComposerAttachment(store, localId, (item) => ({
                ...toComposerAttachment(resource),
                ...(item.localKey === undefined ? {} : { localKey: item.localKey }),
                ...(item.uploadFingerprint === undefined
                  ? {}
                  : { uploadFingerprint: item.uploadFingerprint }),
              })),
            (error) =>
              updateComposerAttachment(store, localId, (item) => ({
                ...item,
                status: 'failed',
                error: {
                  code: 'ATTACHMENT_PROCESSING_FAILED',
                  message:
                    error instanceof Error
                      ? error.message
                      : t('session.composer.attachmentUploadFailed', 'Attachment upload failed.'),
                  retryable: true,
                },
              }))
          )
          .finally(() => unregisterAttachmentUploadTask(localId));
      }
      store.getState().setError(undefined);
    } catch (error) {
      store
        .getState()
        .setError(
          error instanceof Error
            ? error.message
            : t('session.composer.attachmentUploadFailed', 'Attachment upload failed.')
        );
    }
  });

  /**
   * Sends the current draft according to the authoritative runtime state and requested running mode.
   *
   * @param modeOverride - One-shot running mode used by keyboard shortcuts.
   */
  const submit = useMemoizedFn(
    async (composerDraft: ComposerDraft, modeOverride?: RunningMessageMode): Promise<void> => {
      if (sendingDisabled || submitting || publishingRef.current) {
        return;
      }
      const text = composerDraft.text.trim();
      if (text === '') {
        return;
      }
      const requestId = uuidv4();
      const selectedRunningMode = modeOverride ?? runningMessageMode;
      const attachmentIds = store.getState().attachments.map((item) => item.id);
      const workspaceReferences = toWorkspaceReferences(composerDraft.references);
      if (workspaceReferences.length > MAX_WORKSPACE_REFERENCES) {
        store.getState().setError(
          t(
            'session.composer.tooManyReferences',
            'A message can reference at most {{max}} Workspace entries.',
            {
              max: MAX_WORKSPACE_REFERENCES,
            }
          )
        );
        return;
      }
      if (store.getState().attachments.some((item) => item.status !== 'ready')) {
        store
          .getState()
          .setError(
            t(
              'session.composer.attachmentsPending',
              'Wait for every attachment to finish processing before sending.'
            )
          );
        return;
      }
      if (onFirstSubmit) {
        publishingRef.current = true;
        setPublishing(true);
        try {
          await onFirstSubmit(text, attachmentIds, workspaceReferences);
        } catch (error) {
          store.getState().setError(error instanceof Error ? error.message : 'Could not send message.');
        } finally {
          publishingRef.current = false;
          setPublishing(false);
        }
        return;
      }
      const message = running
        ? {
            type: selectedRunningMode === 'steer' ? ('agent.steer' as const) : ('agent.follow-up' as const),
            requestId,
            sessionId,
            runtimeId,
            epoch,
            payload: {
              message: text,
              attachmentIds,
              ...(workspaceReferences.length === 0 ? {} : { workspaceReferences }),
            },
          }
        : {
            type: 'agent.prompt' as const,
            requestId,
            sessionId,
            runtimeId,
            epoch,
            payload: {
              message: text,
              attachmentIds,
              ...(workspaceReferences.length === 0 ? {} : { workspaceReferences }),
            },
          };
      try {
        publishingRef.current = true;
        send(message);
        store.getState().appendOptimisticUserMessage(requestId, text);
        draftRef.current = { text: '', references: [] };
        onPromptSubmitted?.();
      } catch (error) {
        store
          .getState()
          .setError(
            error instanceof Error
              ? error.message
              : t('session.composer.sendFailed', 'Could not send message.')
          );
      } finally {
        publishingRef.current = false;
        setPublishing(false);
      }
    }
  );

  /**
   * Sends the current draft with the Composer's selected running-message mode.
   */
  const submitSelectedMode = useMemoizedFn((): void => {
    submit(draftRef.current, runningMessageMode);
  });

  /**
   * Stops the active Agent run while preserving the Composer draft.
   */
  const stop = useMemoizedFn(async (): Promise<void> => {
    if (interactionDisabled) {
      return;
    }
    const requestId = uuidv4();
    store.getState().setError(undefined);
    try {
      await awaitRealtimeCommand(realtimeClient, requestId, () =>
        send({ type: 'agent.abort', requestId, sessionId, runtimeId, epoch })
      );
    } catch (error) {
      store
        .getState()
        .setError(
          error instanceof Error
            ? error.message
            : t('session.composer.stopFailed', 'Could not stop the session.')
        );
    }
  });

  useShortcut(
    ShortcutKeyRegister.FOCUS_COMPOSER,
    () => {
      editorRef.current?.focus();
      return true;
    },
    // Drafting remains available while runtime actions are disabled.
    { enabled: !publishing }
  );

  useShortcut(
    ShortcutKeyRegister.STOP_GENERATION,
    () => {
      void stop();
      return true;
    },
    { enabled: running }
  );

  /**
   * Routes Enter gestures through the user's send binding; Alt+<send combo> stays the alternate-submit gesture.
   */
  const isSubmitEvent = useMemoizedFn((event: KeyboardEvent): boolean => {
    if (sendBinding === null) {
      return false;
    }
    return (
      comboMatches(event, sendBinding) ||
      (!sendBinding.includes('Alt+') && comboMatches(event, sendBinding, { ignoreAlt: true }))
    );
  });

  /**
   * Mirrors Lexical's transport-compatible text into the Session draft store.
   */
  const handleDraftChange = useMemoizedFn((nextDraft: ComposerDraft): void => {
    draftRef.current = nextDraft;
    store.getState().setDraft(nextDraft.text);
    onDraftChange?.(nextDraft);
  });

  /**
   * Routes Lexical's alternate Enter gesture to the running follow-up queue.
   */
  const handleEditorSubmit = useMemoizedFn((nextDraft: ComposerDraft, alternate: boolean): void => {
    submit(nextDraft, running && alternate ? 'follow-up' : runningMessageMode);
  });

  /**
   * Executes one Host command through its owning Web, HTTP, or realtime adapter.
   */
  const executeHostCommand = useMemoizedFn(async (command: ComposerCommand): Promise<void> => {
    if (interactionDisabled) {
      return;
    }
    try {
      switch (command.name) {
        case 'compact':
          send({ type: 'agent.compact', requestId: uuidv4(), sessionId, runtimeId, epoch });
          break;
        case 'model':
          setModelOpen(true);
          break;
        case 'settings':
          await navigate({
            to: '.',
            search: (previous) => ({
              ...previous,
              settings: { path: '/settings/model-providers' },
            }),
            mask: {
              to: '/settings/model-providers',
              search: {},
              unmaskOnReload: true,
            },
          });
          break;
        case 'new':
          useWorkbenchHome.getState().ensureDraftId(session.workspaceId);
          await navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: session.workspaceId } });
          break;
        case 'fork':
        case 'clone': {
          const derived = await deriveSession.mutateAsync(command.name);
          await navigate({
            to: '/workspaces/$workspaceId/sessions/$sessionId',
            params: { workspaceId: derived.session.workspaceId, sessionId: derived.session.id },
            search: (previous) => previous,
          });
          break;
        }
        case 'name':
          setRenameOpen(true);
          break;
        case 'export':
          download(getSessionExportUrl(session.workspaceId, sessionId), `${sessionId}.html`);
          break;
        default:
          throw new Error(`Unsupported Host command: /${command.name}`);
      }
      store.getState().setError(undefined);
    } catch (error) {
      store
        .getState()
        .setError(
          error instanceof Error
            ? error.message
            : t('session.composer.commandFailed', 'Could not execute command.')
        );
    }
  });

  /**
   * Starts a Host command without making Lexical await external navigation or dialogs.
   */
  const handleCommand = useMemoizedFn((command: ComposerCommand): void => {
    void executeHostCommand(command);
  });

  /**
   * Switches the Session's active model and updates the cached session list optimistically.
   */
  const handleModelChange = useMemoizedFn((value: string): void => {
    if (interactionDisabled) {
      return;
    }
    if (onDraftModelChange) {
      onDraftModelChange(value);
      return;
    }
    const [provider, ...id] = value.split('/');
    send({
      type: 'agent.set-model',
      requestId: uuidv4(),
      sessionId,
      runtimeId,
      epoch,
      payload: { provider: provider ?? '', modelId: id.join('/') },
    });
    if (session.isDraft) {
      queryClient.setQueryData<SessionDto>(
        queryKeys.sessionDraft(session.workspaceId, sessionId),
        (draftSession) =>
          draftSession === undefined
            ? undefined
            : { ...draftSession, provider: provider ?? '', model: id.join('/') }
      );
    }
    queryClient.setQueryData<SessionDto[]>(queryKeys.sessions(session.workspaceId), (sessions) =>
      sessions?.map((candidate) =>
        candidate.id === session.id
          ? { ...candidate, provider: provider ?? '', model: id.join('/') }
          : candidate
      )
    );
  });

  /**
   * Adjusts the Session's reasoning effort level.
   */
  const handleThinkingChange = useMemoizedFn((value: ThinkingLevel): void => {
    if (onDraftControlsChange) {
      onDraftControlsChange({ thinkingLevel: value });
      return;
    }
    if (interactionDisabled) {
      return;
    }
    send({
      type: 'agent.set-thinking',
      requestId: uuidv4(),
      sessionId,
      runtimeId,
      epoch,
      payload: { level: value },
    });
  });

  /**
   * Changes the permission mode through the fenced Session control plane.
   */
  const handlePermissionModeChange = useMemoizedFn((mode: PermissionMode): void => {
    if (onDraftControlsChange) {
      onDraftControlsChange({ permissionMode: mode });
      return;
    }
    if (interactionDisabled) {
      return;
    }
    send({
      type: 'agent.set-permission-mode',
      requestId: uuidv4(),
      sessionId,
      runtimeId,
      epoch,
      payload: { mode },
    });
  });

  /**
   * Sends one explicit Plan extension transition while retaining the last authoritative browser state.
   */
  const requestWorkModeChange = useMemoizedFn(
    (mode: AgentWorkMode, knowledge?: KnowledgeModeConfig): void => {
      if (onDraftControlsChange) {
        onDraftControlsChange({ workMode: mode, ...(knowledge ? { knowledge } : {}) });
        return;
      }
      if (interactionDisabled || (mode === workMode && !knowledge)) {
        return;
      }
      const requestId = uuidv4();
      store.getState().beginWorkModeChange(requestId, mode);
      try {
        send({
          type: 'agent.set-work-mode',
          requestId,
          sessionId,
          runtimeId,
          epoch,
          payload: { mode, ...(knowledge ? { knowledge } : {}) },
        });
      } catch (error) {
        store
          .getState()
          .rejectWorkModeChange(
            requestId,
            error instanceof Error
              ? error.message
              : t('session.composer.workModeFailed', 'Could not change Agent mode.')
          );
      }
    }
  );

  /**
   * Routes Select choices to the runtime control plane and protects a ready plan from accidental discard.
   */
  const handleWorkModeChange = useMemoizedFn((mode: AgentWorkMode): void => {
    if (mode !== 'plan' && planMode.phase === 'ready') {
      setExitTarget(mode);
      setPlanExitOpen(true);
      return;
    }
    requestWorkModeChange(mode);
  });

  const placeholder =
    placeholderOverride ??
    (variant === 'home'
      ? t('session.composer.placeholderHome', 'Tell Dr.Octopus what you want to accomplish…')
      : t('session.composer.placeholderDefault', 'Ask Dr.Octopus anything…'));

  const composerCommands = commands
    .filter(
      (command) => !session.isDraft || !['fork', 'clone', 'name', 'export', 'compact'].includes(command.name)
    )
    .map((command) => {
      const blockedByRun = running && ['compact', 'model', 'fork', 'clone'].includes(command.name);
      /**
       * Selects blocked by run in the existing condition order.
       */
      function selectBlockedByRun() {
        if (blockedByRun) {
          return {
            disabledReason: t(
              'session.composer.unavailableWhileRunning',
              'Unavailable while the Agent is running.'
            ),
          };
        } else if (command.disabledReason === undefined) {
          return {};
        } else {
          return { disabledReason: command.disabledReason };
        }
      }
      return {
        name: command.name,
        ...(command.description === undefined ? {} : { description: command.description }),
        group: command.source,
        execution: command.execution,
        enabled: command.enabled && !blockedByRun && !interactionDisabled,
        ...selectBlockedByRun(),
      };
    });

  /**
   * Selects thinking levels in the existing condition order.
   */
  function selectThinkingLevels() {
    if (onFirstSubmit) {
      return (
        models.find((model) => `${model.provider}/${model.id}` === modelValue)?.thinkingLevels ?? ['off']
      );
    } else if (controlsLoaded) {
      return thinking.availableLevels;
    } else {
      return [];
    }
  }
  return (
    <div
      className={
        variant === 'home'
          ? 'w-full'
          : 'mx-auto w-[calc(100%-20px)] pb-2.5 sm:w-[min(calc(100%-32px),880px)] sm:pb-4.5'
      }
    >
      <ExtensionDialogHost sessionId={sessionId} runtimeId={runtimeId} epoch={epoch} />
      {workMode === 'knowledge' && knowledgeState && (
        <KnowledgeModeBar
          workspaceId={session.workspaceId}
          state={knowledgeState}
          disabled={interactionDisabled || running}
          onChange={(config) => requestWorkModeChange('knowledge', config)}
        />
      )}
      <ComposerAttachments
        disabled={interactionDisabled}
        sessionId={sessionId}
        workspaceId={session.workspaceId}
      />
      <div
        aria-label="composer"
        aria-busy={interactionDisabled}
        className="overflow-hidden rounded-xl border bg-background shadow-[0_8px_26px_color-mix(in_oklch,var(--foreground)_7%,transparent)]"
      >
        <AgentComposerEditor
          ref={editorRef}
          key={sessionId}
          value={draft}
          initialEditorState={initialDraft?.editorState}
          placeholder={placeholder}
          references={references}
          commands={composerCommands}
          disabled={publishing || firstSubmitPending}
          isSubmitEvent={isSubmitEvent}
          keyShortcutsHint={keyShortcutsHint}
          onChange={handleDraftChange}
          onSubmit={handleEditorSubmit}
          onCommand={handleCommand}
        />
        <div role="toolbar" className="flex flex-nowrap items-center gap-1 p-2 md:flex-wrap">
          <div className="hidden items-center gap-1 md:flex">
            <Upload
              disabled={interactionDisabled}
              multiple
              onChange={(event) => {
                void attach(Array.from(event.target.files ?? []));
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Attach files"
                      disabled={interactionDisabled}
                    >
                      <PaperclipIcon />
                    </Button>
                  }
                />
                <TooltipContent>{t('session.composer.attachFiles', 'Attach files')}</TooltipContent>
              </Tooltip>
            </Upload>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open commands"
                    disabled={interactionDisabled}
                    onClick={() => editorRef.current?.insertTrigger('/')}
                  >
                    <SquareSlashIcon />
                  </Button>
                }
              />
              <TooltipContent>{t('session.composer.commandsTooltip', 'Commands')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Mention workspace file or folder"
                    disabled={interactionDisabled}
                    onClick={() => editorRef.current?.insertTrigger('@')}
                  >
                    <AtSignIcon />
                  </Button>
                }
              />
              <TooltipContent>
                {t('session.composer.mentionTooltip', 'Mention file or folder')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Insert /goal command"
                    disabled={interactionDisabled}
                    onClick={() => editorRef.current?.insertCommand('goal')}
                  >
                    <TargetIcon />
                  </Button>
                }
              />
              <TooltipContent>{t('session.composer.goalTooltip', 'Goal')}</TooltipContent>
            </Tooltip>
          </div>
          <div className={running ? 'contents md:hidden' : 'contents'}>
            <WorkModeSelect
              loaded={controlsLoaded}
              knowledgeAvailable={knowledgeState !== undefined}
              disabled={interactionDisabled || running}
              planAvailable={Boolean(onFirstSubmit) || planMode.available}
              value={workMode}
              onValueChange={handleWorkModeChange}
            />
            <ModelThinkingSelect
              disabled={interactionDisabled || running}
              models={models}
              open={modelOpen}
              onOpenChange={setModelOpen}
              modelValue={modelValue}
              followDefault={followDefaultModel}
              onFollowDefault={onFollowDefaultModel}
              thinkingLevels={selectThinkingLevels()}
              thinkingValue={draftControls?.thinkingLevel ?? thinking.level}
              onModelValueChange={handleModelChange}
              onThinkingValueChange={handleThinkingChange}
            />
          </div>
          <PermissionSelect
            loaded={controlsLoaded}
            disabled={interactionDisabled}
            value={draftControls?.permissionMode ?? permissionMode}
            onValueChange={handlePermissionModeChange}
          />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <div className="hidden md:block">
              <ContextUsageIndicator
                usage={contextUsage}
                autoCompactionEnabled={session.preferences.autoCompactionEnabled}
              />
            </div>
            {running && (
              <div className="hidden md:block">
                <RunningMessageControls
                  disabled={interactionDisabled}
                  mode={runningMessageMode}
                  followUpCount={followUpCount}
                  sendDisabled={sendingDisabled || draft.trim() === '' || !attachmentsReady}
                  onModeChange={setRunningMessageMode}
                  onSend={submitSelectedMode}
                  onStop={stop}
                />
              </div>
            )}
            <Button
              className={running ? 'shrink-0 md:hidden' : 'shrink-0'}
              onClick={submitSelectedMode}
              disabled={sendingDisabled || submitting || draft.trim() === '' || !attachmentsReady}
              size="icon"
              title={
                connecting ? t('session.composer.waitingForAgent', 'Waiting for Agent…') : sendButtonTitle
              }
              aria-busy={connecting || submitting}
              aria-label={submitting ? 'Sending message' : 'Send message'}
            >
              {connecting || submitting ? <Spinner /> : <ArrowUpIcon />}
            </Button>
          </div>
        </div>
      </div>
      <RenameSessionDialog
        session={session}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRename={async (target, title) => {
          await renameSession.mutateAsync({ session: target, title });
        }}
      />
      <PlanModeExitDialog
        open={planExitOpen}
        onOpenChange={setPlanExitOpen}
        onConfirm={() => requestWorkModeChange(exitTarget)}
      />
    </div>
  );
}

/**
 * Applies a local upload callback to the matching card across temporary and durable identity changes.
 */
function updateComposerAttachment(
  store: SessionStoreApi,
  localId: string,
  update: (item: ComposerAttachmentViewModel) => ComposerAttachmentViewModel
): void {
  store.setState((state) => ({
    attachments: state.attachments.map((item) =>
      item.id === localId || item.localKey === localId ? update(item) : item
    ),
  }));
}
