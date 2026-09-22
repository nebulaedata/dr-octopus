/**
 * @author Codex
 * @description Groups collection reIndexing, revision-aware metadata editing and explicit visibility revocation.
 */
import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EllipsisVerticalIcon,
  PencilIcon,
  RefreshCcwDotIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@octopus/ui/components/dropdown-menu';
import { toast } from '@octopus/ui/components/toast';
import { Spinner } from '@octopus/ui/components/spinner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { Input } from '@octopus/ui/components/input';
import { Textarea } from '@octopus/ui/components/textarea';
import { Field, FieldLabel } from '@octopus/ui/components/field';
import {
  deleteKnowledgeResource,
  updateKnowledgeCollection,
  reindexKnowledgeCollection,
  getKnowledgeJob,
} from '@/api/knowledge';
import { KnowledgeJobFeedback } from './KnowledgeJobFeedback';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeCollection } from '@octopus/shared/protocol/knowledge';

/**
 * Keep collection actions independent of document uploads and query pagination.
 */
export function KnowledgeCollectionActions({
  workspaceId,
  collection,
}: {
  workspaceId?: string;
  collection: KnowledgeCollection;
}) {
  const [open, setOpen] = useState<'edit' | 'delete'>();
  const cache = useQueryClient();
  const { t } = useI18n();
  const [jobId, setJobId] = useState<string>();
  const job = useQuery({
    queryKey: ['knowledge', workspaceId ?? 'global', 'job', jobId],
    enabled: !!jobId,
    queryFn: ({ signal }) => getKnowledgeJob(workspaceId, jobId!, signal),
  });
  const reindex = useMutation({
    mutationFn: () => reindexKnowledgeCollection(workspaceId, collection.id, crypto.randomUUID()),
    onSuccess: (value) => setJobId(value.id),
    onError: (error) =>
      toast.add({
        title: t('knowledge.collectionActions.reindexFailed', 'Reindex failed'),
        description: error.message,
        type: 'error',
      }),
  });
  const refresh = () => {
    setOpen(undefined);
    void cache.invalidateQueries({ queryKey: ['knowledge', workspaceId ?? 'global'] });
  };
  const save = useMutation({
    onError: (error) => {
      toast.add({
        title: t('knowledge.collectionActions.saveFailed', 'Failed to save collection'),
        description: error.message,
        type: 'error',
      });
    },
    mutationFn: (value: { name: string; description: string }) =>
      updateKnowledgeCollection(workspaceId, collection, value),
    onSuccess: refresh,
  });
  const remove = useMutation({
    onError: (error) => {
      toast.add({
        title: t('knowledge.collectionActions.deleteFailed', 'Failed to delete collection'),
        description: error.message,
        type: 'error',
      });
    },
    mutationFn: () => deleteKnowledgeResource(workspaceId, 'collections', collection.id, collection.revision),
    onSuccess: refresh,
  });
  const form = useForm({
    defaultValues: { name: collection.name, description: collection.description },
    onSubmit: ({ value }) => save.mutateAsync(value).then(() => undefined),
  });
  return (
    <>
      {job.data ? <KnowledgeJobFeedback workspaceId={workspaceId} result={job.data} /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={`Actions for ${collection.name}`}
        >
          <EllipsisVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                form.reset({ name: collection.name, description: collection.description });
                setOpen('edit');
              }}
            >
              <PencilIcon />
              {t('knowledge.collectionActions.editName', 'Edit name')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                reindex.isPending ||
                (!!job.data && ['queued', 'running', 'waiting_dependency'].includes(job.data.job.state))
              }
              onClick={() => reindex.mutate()}
            >
              <RefreshCcwDotIcon />
              {t('knowledge.collectionActions.reindex', 'Reindex')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setOpen('delete')}>
              <Trash2Icon />
              {t('knowledge.collectionActions.delete', 'Delete collection')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={!!open}
        onOpenChange={(value) => {
          if (!value) {
            setOpen(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open === 'edit'
                ? t('knowledge.collectionActions.editTitle', 'Edit knowledge collection')
                : t('knowledge.collectionActions.deleteTitle', 'Delete knowledge collection?')}
            </DialogTitle>
            <DialogDescription>
              {open === 'edit'
                ? t('knowledge.collectionActions.editDescription', 'Update the name and description.')
                : t('knowledge.common.irreversible', 'This action cannot be undone.')}
            </DialogDescription>
          </DialogHeader>
          {open === 'edit' ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void form.handleSubmit().catch(() => undefined);
              }}
            >
              <form.Field name="name">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="knowledge-collection-name">
                      {t('knowledge.collectionActions.nameLabel', 'Name')}
                    </FieldLabel>
                    <Input
                      id="knowledge-collection-name"
                      maxLength={120}
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="description">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="knowledge-collection-description">
                      {t('knowledge.common.descriptionLabel', 'Description')}
                    </FieldLabel>
                    <Textarea
                      id="knowledge-collection-description"
                      maxLength={2000}
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </Field>
                )}
              </form.Field>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Spinner data-icon="inline-start" />}
                  {t('common.save', 'Save')}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">{collection.name}</span>
                  {'. '}
                  {t(
                    'knowledge.collectionActions.deleteWarning',
                    'This deletes the collection and all of its documents; existing references will stop working.'
                  )}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(undefined)}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  {remove.isPending && <Spinner data-icon="inline-start" />}
                  {t('knowledge.collectionActions.delete', 'Delete collection')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
