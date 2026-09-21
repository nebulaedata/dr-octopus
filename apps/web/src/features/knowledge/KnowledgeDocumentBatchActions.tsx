/**
 * @author Codex
 * @description Applies confirmed deletion and scoped indexing to an explicit document selection.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCcwDotIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { deleteKnowledgeResource, reindexKnowledgeCollection } from '@/api/knowledge';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeDocument, KnowledgeJob } from '@octopus/shared/protocol/knowledge';

/**
 * Freezes deletion targets at confirmation and retains failed selections for an explicit retry.
 */
export function KnowledgeDocumentBatchActions({
  workspaceId,
  collectionId,
  documents,
  onPendingChange,
  onRemoved,
  onJob,
}: {
  workspaceId?: string;
  collectionId: string;
  documents: KnowledgeDocument[];
  /**
   * Locks selection and pagination while requests are being submitted.
   */
  onPendingChange(pending: boolean): void;
  /**
   * Clears only successfully deleted targets from the selection.
   */
  onRemoved(ids: string[]): void;
  /**
   * Tracks the submitted indexing job until it settles.
   */
  onJob(job: KnowledgeJob): void;
}) {
  const [targets, setTargets] = useState<KnowledgeDocument[]>();
  const cache = useQueryClient();
  const { t } = useI18n();
  const remove = useMutation({
    mutationFn: async (selection: KnowledgeDocument[]) => {
      const results = await Promise.allSettled(
        selection.map((document) =>
          deleteKnowledgeResource(workspaceId, 'documents', document.id, document.revision)
        )
      );
      return { selection, results };
    },
    onMutate: () => onPendingChange(true),
    onSuccess: ({ selection, results }) => {
      const removed = selection.filter((_, index) => results[index].status === 'fulfilled');
      const failed = selection.filter((_, index) => results[index].status === 'rejected');
      onRemoved(removed.map((document) => document.id));
      setTargets(undefined);
      const error = results.find((result) => result.status === 'rejected');
      toast.add({
        title: failed.length
          ? t('knowledge.batchActions.deletePartial', 'Deleted {{removed}}; {{failed}} failed to delete', {
              removed: removed.length,
              failed: failed.length,
            })
          : t('knowledge.batchActions.deleteSuccess', '{{count}} documents deleted', {
              count: removed.length,
            }),
        description: failed.length
          ? t('knowledge.batchActions.deleteFailureDescription', '{{titles}}: {{message}}', {
              titles: failed
                .map((document) => document.title)
                .join(t('knowledge.batchActions.titleSeparator', ', ')),
              message:
                error?.reason instanceof Error
                  ? error.reason.message
                  : t('knowledge.batchActions.retryFallback', 'Refresh and try again'),
            })
          : undefined,
        type: failed.length ? 'error' : 'success',
      });
      void cache.invalidateQueries({ queryKey: ['knowledge', workspaceId ?? 'global', collectionId] });
    },
    onSettled: () => onPendingChange(false),
  });
  const reindex = useMutation({
    mutationFn: (selection: KnowledgeDocument[]) =>
      reindexKnowledgeCollection(
        workspaceId,
        collectionId,
        crypto.randomUUID(),
        selection.map((document) => document.id)
      ),
    onMutate: () => onPendingChange(true),
    onSuccess: onJob,
    onError: (error) =>
      toast.add({
        title: t('knowledge.batchActions.indexFailed', 'Batch indexing failed'),
        description: error.message,
        type: 'error',
      }),
    onSettled: () => onPendingChange(false),
  });
  const pending = remove.isPending || reindex.isPending;
  return (
    <>
      <div
        role="group"
        aria-label="Selected document actions"
        className="flex flex-wrap items-center gap-2"
      >
        {documents.length > 0 ? (
          <span className="text-xs text-muted-foreground mr-2">
            {t('knowledge.batchActions.selectedCount', '{{count}} selected', { count: documents.length })}
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" disabled={!documents.length || pending} />}
            aria-label="Delete selected documents"
            disabled={!documents.length || pending}
            onClick={() => setTargets([...documents])}
          >
            {remove.isPending ? <Spinner /> : <Trash2Icon />}
          </TooltipTrigger>
          <TooltipContent>{t('knowledge.batchActions.deleteTooltip', 'Delete the selected documents')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" disabled={!documents.length || pending} />}
            aria-label="Index selected documents"
            disabled={!documents.length || pending}
            onClick={() => reindex.mutate([...documents])}
          >
            {reindex.isPending ? <Spinner /> : <RefreshCcwDotIcon />}
          </TooltipTrigger>
          <TooltipContent>
            {t(
              'knowledge.batchActions.indexTooltip',
              "Index selected: rebuild only the selected documents with the collection's current indexing configuration"
            )}
          </TooltipContent>
        </Tooltip>
      </div>
      <Dialog
        open={!!targets}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) {
            setTargets(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('knowledge.batchActions.dialogTitle', 'Delete the selected {{count}} documents?', {
                count: targets?.length ?? 0,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'knowledge.batchActions.dialogDescription',
                'This cannot be undone; existing references will stop working.'
              )}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            {targets?.map((document) => (
              <li key={document.id} className="truncate" title={document.title}>
                {document.title}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={remove.isPending} onClick={() => setTargets(undefined)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending || !targets?.length}
              onClick={() => targets && remove.mutate(targets)}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('knowledge.batchActions.confirmDelete', 'Delete documents')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
