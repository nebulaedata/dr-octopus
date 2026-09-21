/**
 * @author Codex
 * @description Inspect complete memory and provenance before an explicit edit or revision-checked forget.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { Button } from '@octopus/ui/components/button';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { toast } from '@octopus/ui/components/toast';
import { forgetMemory } from '@/api/memory';
import { memoryDocumentQuery, memoryQueryKey } from '@/queries/memory-queries';
import { useI18n } from '@/i18n/use-i18n';
import { MemoryEditor } from './MemoryEditor';
import type { MemoryRef } from '@octopus/shared/protocol/memory';
/**
 * Require a complete read before enabling edit, and a second explicit action before deletion.
 */
export function MemoryDetail({ reference, onClose }: { reference: MemoryRef; onClose(): void }) {
  const { t } = useI18n();
  const result = useQuery(memoryDocumentQuery(reference));
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: forgetMemory,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: memoryQueryKey });
      toast.add({ title: t('memory.detail.forgotten', 'Memory forgotten'), type: 'success' });
      onClose();
    },
  });
  if (editing && result.data) {
    return <MemoryEditor document={result.data} onClose={() => setEditing(false)} />;
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {confirming ? t('memory.detail.confirmTitle', 'Forget this memory?') : (result.data?.indexText ?? t('memory.detail.viewTitle', 'View memory'))}
          </DialogTitle>
          <DialogDescription>
            {confirming
              ? t(
                  'memory.detail.confirmDescription',
                  'This fact and its history will be deleted, effective immediately in all workspaces. Original session records are kept.'
                )
              : (result.data?.topic ?? t('memory.detail.loading', 'Loading content and sources'))}
          </DialogDescription>
        </DialogHeader>
        {result.isPending && <Skeleton className="h-40 w-full" />}
        {(result.error || mutation.error) && (
          <Alert variant="destructive">
            <AlertDescription>{result.error?.message ?? mutation.error?.message}</AlertDescription>
          </Alert>
        )}
        {result.data && !confirming && (
          <div className="flex max-h-[55vh] flex-col gap-4 overflow-auto">
            <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-6">{result.data.bodyMd}</p>
            <details className="text-xs text-muted-foreground">
              <summary>
                {t('memory.detail.sourcesVersion', 'Sources & version · v{{revision}}', {
                  revision: result.data.revision,
                })}
              </summary>
              {result.data.sources.length ? (
                result.data.sources.map((source) => (
                  <p
                    className="mt-2 whitespace-pre-wrap wrap-anywhere"
                    key={source.sessionId + source.entryId}
                  >
                    {source.evidence}
                  </p>
                ))
              ) : (
                <p>{t('memory.detail.directSave', 'Saved directly by the user')}</p>
              )}
            </details>
          </div>
        )}
        <DialogFooter>
          {confirming ? (
            <>
              <Button variant="ghost" disabled={mutation.isPending} onClick={() => setConfirming(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={mutation.isPending}
                onClick={() => {
                  if (result.data) {
                    mutation.mutate({
                      requestId: crypto.randomUUID(),
                      ref: reference,
                      expectedRevision: result.data.revision,
                    });
                  }
                }}
              >
                {t('memory.detail.confirmForget', 'Confirm forget')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t('common.close', 'Close')}
              </Button>
              <Button variant="outline" disabled={!result.data} onClick={() => setEditing(true)}>
                {t('common.edit', 'Edit')}
              </Button>
              <Button variant="destructive" disabled={!result.data} onClick={() => setConfirming(true)}>
                {t('memory.detail.forget', 'Forget')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
