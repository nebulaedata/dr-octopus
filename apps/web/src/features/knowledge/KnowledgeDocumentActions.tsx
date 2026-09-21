/**
 * @author Codex
 * @description Document row menu: revision-fenced rename, source replacement and confirmed deletion behind one compact dropdown.
 */
import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EllipsisVerticalIcon, PencilIcon, ReplaceIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { toast } from '@octopus/ui/components/toast';
import { Input } from '@octopus/ui/components/input';
import { Spinner } from '@octopus/ui/components/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { Field, FieldLabel } from '@octopus/ui/components/field';
import { deleteKnowledgeResource, renameKnowledgeDocument, uploadKnowledgeDocument } from '@/api/knowledge';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeDocument, KnowledgeJob } from '@octopus/shared/protocol/knowledge';

/**
 * Keeps every row-level mutation behind one menu so dense tables stay scannable.
 */
export function KnowledgeDocumentActions({
  workspaceId,
  document,
  onJob,
}: {
  workspaceId?: string;
  document: KnowledgeDocument;
  onJob(job: KnowledgeJob): void;
}) {
  const [dialog, setDialog] = useState<'rename' | 'delete'>();
  const fileInput = useRef<HTMLInputElement>(null);
  const cache = useQueryClient();
  const { t } = useI18n();

  /**
   * Refreshes the owning collection's document list after any row mutation.
   */
  function invalidateDocuments() {
    void cache.invalidateQueries({
      queryKey: ['knowledge', workspaceId ?? 'global', document.collectionId],
    });
  }
  const save = useMutation({
    onError: (error) => {
      toast.add({
        title: t('knowledge.documentActions.renameFailed', 'Failed to rename document'),
        description: error.message,
        type: 'error',
      });
    },
    mutationFn: (title: string) => renameKnowledgeDocument(workspaceId, document, title),
    onSuccess: () => {
      setDialog(undefined);
      invalidateDocuments();
    },
  });
  const replace = useMutation({
    onError: (error) => {
      toast.add({
        title: t('knowledge.documentActions.replaceFailed', 'Failed to replace document'),
        description: error.message,
        type: 'error',
      });
    },
    mutationFn: (file: File) =>
      uploadKnowledgeDocument(workspaceId, document.collectionId, file, crypto.randomUUID(), document),
    onSuccess: onJob,
  });
  const remove = useMutation({
    onError: (error) => {
      toast.add({
        title: t('knowledge.documentActions.deleteFailed', 'Failed to delete document'),
        description: error.message,
        type: 'error',
      });
    },
    mutationFn: () => deleteKnowledgeResource(workspaceId, 'documents', document.id, document.revision),
    onSuccess: () => {
      setDialog(undefined);
      invalidateDocuments();
    },
  });
  const form = useForm({
    defaultValues: { title: document.title },
    onSubmit: ({ value }) => save.mutateAsync(value.title).then(() => undefined),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" />}
          aria-label={`Actions for ${document.title}`}
        >
          <EllipsisVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                form.reset({ title: document.title });
                setDialog('rename');
              }}
            >
              <PencilIcon />
              {t('knowledge.documentActions.rename', 'Rename')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={replace.isPending} onClick={() => fileInput.current?.click()}>
              <ReplaceIcon />
              {t('knowledge.documentActions.replace', 'Replace document')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setDialog('delete')}>
              <Trash2Icon />
              {t('knowledge.documentActions.delete', 'Delete document')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".docx,.xlsx,.pptx,.csv,.md,.txt,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) {
            replace.mutate(file);
          }
        }}
      />
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'rename'
                ? t('knowledge.documentActions.renameTitle', 'Rename knowledge document')
                : t('knowledge.documentActions.deleteTitle', 'Delete document?')}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'rename'
                ? t(
                    'knowledge.documentActions.renameDescription',
                    'Change the display name; document content and references are kept.'
                  )
                : t('knowledge.common.irreversible', 'This action cannot be undone.')}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'rename' ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void form.handleSubmit().catch(() => undefined);
              }}
            >
              <form.Field name="title">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="knowledge-document-title">
                      {t('knowledge.documentActions.titleLabel', 'Document title')}
                    </FieldLabel>
                    <Input
                      id="knowledge-document-title"
                      maxLength={240}
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </Field>
                )}
              </form.Field>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending && <Spinner data-icon="inline-start" />}
                  {t('knowledge.documentActions.saveName', 'Save name')}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">{document.title}</span>
                  {'. '}
                  {t(
                    'knowledge.documentActions.deleteWarning',
                    'This document will no longer be retrievable, and existing references will also stop working.'
                  )}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(undefined)}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  {remove.isPending && <Spinner data-icon="inline-start" />}
                  {t('knowledge.documentActions.delete', 'Delete document')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
