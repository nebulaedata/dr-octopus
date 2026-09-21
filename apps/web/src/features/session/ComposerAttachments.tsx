/**
 * @author root
 * @description Renders and synchronizes the six-state Composer attachment task tray above the input.
 */

import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileIcon, ImageIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { useStore } from 'zustand';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@octopus/ui/components/attachment';
import { Progress } from '@octopus/ui/components/progress';
import { Spinner } from '@octopus/ui/components/spinner';
import { deleteAttachment, getAttachments, retryAttachment } from '@/api/attachments';
import { HorizontalArea } from '@/components/HorizontalArea';
import { useI18n } from '@/i18n/use-i18n';
import { sessionStores } from '@/stores/session';
import { AttachmentDiagnostics } from './AttachmentDiagnostics';
import { documentCoverageLabel } from './document-coverage-label';
import { abortAttachmentUploadTask } from './attachment-upload-tasks';
import { cn } from '@octopus/ui/lib/utils';
import type { AttachmentResourceDto } from '@octopus/shared/protocol/attachments';
import type { ComposerAttachmentViewModel } from '@/stores/session';
import type { Translate } from '@/i18n/use-i18n';

export interface ComposerAttachmentsProps {
  disabled?: boolean;
  sessionId: string;
  workspaceId: string;
}

/**
 * Owns revision polling, monotonic merge, retry, removal, and task-state presentation.
 */
export function ComposerAttachments({ disabled = false, sessionId, workspaceId }: ComposerAttachmentsProps) {
  const { t } = useI18n();
  const store = sessionStores.ensure(sessionId);
  const attachments = useStore(store, (state) => state.attachments);
  const ids = attachments.filter((item) => !item.id.startsWith('local-')).map((item) => item.id);
  const needsPolling = attachments.some(
    (item) => item.status === 'uploading' || item.status === 'processing'
  );
  const lastRevisionSignature = useRef('');
  const pollStep = useRef(0);
  const query = useQuery({
    queryKey: ['attachments', workspaceId, ids],
    queryFn: ({ signal }) => getAttachments(workspaceId, ids, signal),
    enabled: ids.length > 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
    refetchInterval(queryState) {
      if (!needsPolling) {
        return false;
      }
      const data = queryState.state.data as { items: AttachmentResourceDto[] } | undefined;
      const signature = data?.items.map((item) => `${item.id}:${String(item.revision)}`).join('|') ?? '';
      if (signature !== lastRevisionSignature.current) {
        lastRevisionSignature.current = signature;
        pollStep.current = 0;
      }
      const delay = [1_000, 2_000, 5_000][Math.min(pollStep.current, 2)] ?? 5_000;
      pollStep.current += 1;
      return delay;
    },
  });
  useEffect(() => {
    if (query.data === undefined) {
      return;
    }
    const incoming = new Map(query.data.items.map((item) => [item.id, item]));
    store.setState((state) => ({
      attachments: state.attachments.map((current) => {
        const resource = incoming.get(current.id);
        return resource === undefined || resource.revision < current.revision
          ? current
          : fromResource(resource, current.localKey, current.uploadFingerprint);
      }),
    }));
  }, [query.data, store]);
  const remove = useMutation({
    mutationFn: (item: ComposerAttachmentViewModel) => deleteAttachment(workspaceId, item),
  });
  const retry = useMutation({
    mutationFn: (item: ComposerAttachmentViewModel) => retryAttachment(workspaceId, item),
  });

  if (attachments.length === 0) {
    return null;
  }

  /**
   * Removes a local task immediately or drives the durable deleted transition before removal.
   */
  async function removeAttachment(item: ComposerAttachmentViewModel): Promise<void> {
    if (disabled || item.status === 'deleted') {
      return;
    }
    if (item.localKey !== undefined && (await abortAttachmentUploadTask(item.localKey))) {
      store
        .getState()
        .setAttachments(
          store.getState().attachments.filter((candidate) => candidate.localKey !== item.localKey)
        );
      return;
    }
    if (item.id.startsWith('local-')) {
      store
        .getState()
        .setAttachments(store.getState().attachments.filter((candidate) => candidate.id !== item.id));
      return;
    }
    const previous = item;
    store.setState((state) => ({
      attachments: state.attachments.map((candidate) =>
        candidate.id === item.id ? { ...candidate, status: 'deleted' } : candidate
      ),
    }));
    remove.mutate(item, {
      onSuccess: () =>
        store.setState((state) => ({
          attachments: state.attachments.filter((candidate) => candidate.id !== item.id),
        })),
      onError: (error) =>
        store.setState((state) => ({
          attachments: state.attachments.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...previous,
                  error: { code: 'ATTACHMENT_PROCESSING_FAILED', message: error.message, retryable: true },
                }
              : candidate
          ),
        })),
    });
  }

  /**
   * Requeues only Server-declared retryable failures and merges the returned revision.
   */
  function retryProcessing(item: ComposerAttachmentViewModel): void {
    if (disabled || item.status !== 'failed' || item.error?.retryable !== true) {
      return;
    }
    retry.mutate(item, {
      onSuccess: (resource) =>
        store.setState((state) => ({
          attachments: state.attachments.map((candidate) =>
            candidate.id === item.id
              ? fromResource(resource, candidate.localKey, candidate.uploadFingerprint)
              : candidate
          ),
        })),
    });
  }

  return (
    <HorizontalArea aria-label="Composer attachments" className="w-full">
      <AttachmentGroup className="w-max min-w-full flex-nowrap overflow-visible pb-3 *:data-[slot=attachment]:w-72 *:data-[slot=attachment]:max-w-full">
        {attachments.map((item) => (
          <Attachment
            key={item.id}
            state={attachmentState(item.status)}
            size="sm"
            className={cn(
              'h-16 cursor-default hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/15 transition-shadow duration-200 ease-in-out',
              item.status === 'failed' || item.status === 'deleted' ? 'border-destructive' : '',
              item.status === 'rejected' && 'border-warning'
            )}
          >
            <AttachmentMedia variant="icon">
              {item.status === 'processing' || item.status === 'deleted' ? (
                <Spinner />
              ) : item.presentationKind === 'image' ? (
                <ImageIcon />
              ) : (
                <FileIcon />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle title={item.name}>{item.name}</AttachmentTitle>
              <AttachmentDescription>
                {item.status === 'ready' && documentCoverageLabel(t, item.coverage) ? (
                  <AttachmentDiagnostics text={documentCoverageLabel(t, item.coverage)!} />
                ) : (
                  <span title={description(t, item)}>{description(t, item)}</span>
                )}
              </AttachmentDescription>
              {item.status === 'uploading' && item.progress !== undefined && (
                <Progress value={item.progress.percentage} className="mt-2" />
              )}
            </AttachmentContent>
            <AttachmentActions>
              {item.status === 'failed' && item.error?.retryable === true ? (
                <AttachmentAction
                  aria-label={`Retry ${item.name}`}
                  disabled={disabled || retry.isPending}
                  onClick={() => retryProcessing(item)}
                >
                  <RefreshCwIcon />
                </AttachmentAction>
              ) : null}
              <AttachmentAction
                aria-label={`Remove ${item.name}`}
                disabled={disabled || item.status === 'deleted'}
                onClick={() => void removeAttachment(item)}
              >
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}
      </AttachmentGroup>
    </HorizontalArea>
  );
}

/**
 * Maps six business states onto the primitive's five visual states.
 */
function attachmentState(
  status: ComposerAttachmentViewModel['status']
): 'uploading' | 'processing' | 'done' | 'error' {
  if (status === 'uploading') {
    return 'uploading';
  }
  if (status === 'processing' || status === 'deleted') {
    return 'processing';
  }
  if (status === 'ready') {
    return 'done';
  }
  return 'error';
}
/**
 * Produces stable, non-parser task copy in the active locale.
 */
function description(t: Translate, item: ComposerAttachmentViewModel): string {
  if (item.status === 'uploading' && item.progress !== undefined) {
    return `${formatBytes(item.progress.uploadedBytes)} / ${formatBytes(item.progress.totalBytes)} · ${String(item.progress.percentage)}%`;
  }
  if (item.status === 'processing') {
    return t('session.composer.attachments.statusProcessing', 'Verifying and processing');
  }
  if (item.status === 'failed' || item.status === 'rejected') {
    const statusLabel =
      item.status === 'failed'
        ? t('session.composer.attachments.statusFailed', 'Failed')
        : t('session.composer.attachments.statusRejected', 'Rejected');
    return `${statusLabel}: ${item.error?.message ?? t('session.composer.attachments.unavailable', 'Attachment unavailable')}`;
  }
  if (item.status === 'deleted') {
    return t('session.composer.attachments.statusRemoving', 'Removing');
  }
  return `${item.detectedMediaType ?? t('session.composer.attachments.verifiedFile', 'Verified file')} · ${formatBytes(item.byteSize)}`;
}
/**
 * Maps a monotonic Server resource into Composer state while retaining local-only identity.
 */
function fromResource(
  resource: AttachmentResourceDto,
  localKey?: string,
  uploadFingerprint?: string
): ComposerAttachmentViewModel {
  const status =
    resource.status === 'initiated' || resource.status === 'uploading'
      ? 'uploading'
      : resource.status === 'verifying' || resource.status === 'processing'
        ? 'processing'
        : resource.status;
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
/**
 * Formats byte counts without guessing file type.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KiB`;
  }
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
