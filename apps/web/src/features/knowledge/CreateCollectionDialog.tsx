/**
 * @author Codex
 * @description Focused collection creation form bound to one management scope.
 */
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { Field, FieldError, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Textarea } from '@octopus/ui/components/textarea';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { createKnowledgeCollection } from '@/api/knowledge';
import { useI18n } from '@/i18n/use-i18n';
import type { Translate } from '@/i18n/use-i18n';
import type { KnowledgeCollection } from '@octopus/shared/protocol/knowledge';

/**
 * Validates collection fields for both live feedback and submit.
 */
function createCollectionSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('knowledge.createDialog.nameRule', 'Enter a name of 1–120 characters'))
      .max(120, t('knowledge.createDialog.nameRule', 'Enter a name of 1–120 characters')),
    description: z.string(),
  });
}

/**
 * Preserve field input on server failure and close only after durable creation.
 */
export function CreateCollectionDialog({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId?: string;
  onClose(): void;
  onCreated(collection: KnowledgeCollection): void;
}) {
  const { t } = useI18n();
  const schema = createCollectionSchema(t);
  const mutation = useMutation({
    onError: (error) => {
      toast.add({
        title: t('knowledge.createDialog.failed', 'Failed to create collection'),
        description: error.message,
        type: 'error',
      });
    },
    mutationFn: (value: { name: string; description: string }) =>
      createKnowledgeCollection(workspaceId, value),
    onSuccess: onCreated,
  });
  const form = useForm({
    defaultValues: { name: '', description: '' },
    validators: {
      onChange: schema,
      onSubmit: schema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('knowledge.createDialog.title', 'New knowledge collection')}</DialogTitle>
          <DialogDescription>
            {t('knowledge.createDialog.description', 'Organize materials by topic for the agent to retrieve and cite.')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.Field name="name">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor="collection-name">
                    {t('knowledge.createDialog.nameLabel', 'Collection name')}
                  </FieldLabel>
                  <Input
                    id="collection-name"
                    autoFocus
                    aria-invalid={isInvalid}
                    placeholder={t('knowledge.createDialog.namePlaceholder', 'e.g. Product docs, team handbook')}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="description">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="collection-description">
                  {t('knowledge.common.descriptionLabel', 'Description')}
                </FieldLabel>
                <Textarea
                  id="collection-description"
                  maxLength={2000}
                  placeholder={t(
                    'knowledge.createDialog.descriptionPlaceholder',
                    'Briefly describe the content and purpose of this knowledge'
                  )}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner data-icon="inline-start" />}
              {t('knowledge.createDialog.submit', 'Create collection')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
