/**
 * @author Codex
 * @description Explicit memory authoring with complete-document loading and revision-safe updates.
 */
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { FieldGroup, Field, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Textarea } from '@octopus/ui/components/textarea';
import { Button } from '@octopus/ui/components/button';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { toast } from '@octopus/ui/components/toast';
import { rememberMemory } from '@/api/memory';
import { memoryQueryKey } from '@/queries/memory-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { MemoryDocument, MemoryFact } from '@octopus/shared/protocol/memory';
/**
 * Save a reviewed draft; retain it on a conflict so the user can compare against refreshed memory.
 */
export function MemoryEditor({ document, onClose }: { document?: MemoryDocument; onClose(): void }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const request = useRef<{ signature: string; id: string } | undefined>(undefined);
  const [identity] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: rememberMemory,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: memoryQueryKey });
      toast.add({ title: t('memory.editor.saved', 'Memory saved'), type: 'success' });
      onClose();
    },
  });
  const fieldLabels = {
    topic: t('memory.editor.topicLabel', 'Topic'),
    indexText: t('memory.editor.indexLabel', 'Short index'),
    bodyMd: t('memory.editor.bodyLabel', 'Memory content (Markdown)'),
  };
  const form = useForm({
    defaultValues: {
      topic: document?.topic ?? '用户记录',
      indexText: document?.indexText ?? '',
      bodyMd: document?.bodyMd ?? '',
    },
    onSubmit: async ({ value }) => {
      const signature = JSON.stringify([value, document?.revision]);
      if (request.current?.signature !== signature) {
        request.current = { signature, id: crypto.randomUUID() };
      }
      await mutation.mutateAsync({
        ...value,
        canonicalKey: document?.canonicalKey ?? 'user.note.' + identity,
        type: (document?.type as MemoryFact['type'] | undefined) ?? 'other',
        sources: document?.sources ?? [],
        action: document ? 'update' : 'create',
        requestId: request.current.id,
        ...(document
          ? {
              target: { storeId: document.storeId, indexId: document.indexId },
              expectedRevision: document.revision,
            }
          : {}),
      });
    },
  });
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
          <DialogTitle>{document ? t('memory.editor.editTitle', 'Edit memory') : t('memory.remember', 'Remember something')}</DialogTitle>
          <DialogDescription>
            {t('memory.editor.description', 'After saving, every workspace and session can consult this memory.')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <FieldGroup>
            {(['topic', 'indexText', 'bodyMd'] as const).map((name) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={'memory-' + name}>{fieldLabels[name]}</FieldLabel>
                    {name === 'bodyMd' ? (
                      <Textarea
                        id={'memory-' + name}
                        required
                        maxLength={16000}
                        className="min-h-48 max-h-80"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                    ) : (
                      <Input
                        id={'memory-' + name}
                        required
                        maxLength={name === 'topic' ? 200 : 240}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
            ))}
          </FieldGroup>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('memory.editor.saving', 'Saving…') : t('memory.editor.save', 'Save memory')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
