/**
 * @author Codex
 * @description Converts user-authored text into the same durable import path as file uploads.
 */
import { useForm } from '@tanstack/react-form';
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
import { useI18n } from '@/i18n/use-i18n';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Validates required text fields with inline messages.
 */
function knowledgeTextSchema(t: Translate) {
  return z.object({
    title: z.string().trim().min(1, t('knowledge.textDialog.titleRequired', 'Enter a title')),
    text: z.string().trim().min(1, t('knowledge.textDialog.textRequired', 'Enter the body text')),
  });
}

/**
 * Keeps the authoring surface small while routing saved text through the upload mutation of the parent.
 */
export function KnowledgeTextDialog({
  onClose,
  onSave,
}: {
  onClose(): void;
  onSave(file: File): Promise<void>;
}) {
  const { t } = useI18n();
  const schema = knowledgeTextSchema(t);
  const form = useForm({
    defaultValues: { title: '', text: '' },
    validators: {
      onChange: schema,
      onSubmit: schema,
    },
    onSubmit: async ({ value }) => {
      await onSave(new File([value.text], value.title.trim() + '.md', { type: 'text/markdown' }));
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
          <DialogTitle>{t('knowledge.textDialog.title', 'New knowledge text')}</DialogTitle>
          <DialogDescription>
            {t('knowledge.textDialog.description', 'Use Markdown to format the content.')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.Field name="title">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor="knowledge-text-title">
                    {t('knowledge.textDialog.titleLabel', 'Title')}
                  </FieldLabel>
                  <Input
                    id="knowledge-text-title"
                    maxLength={200}
                    aria-invalid={isInvalid}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="text">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor="knowledge-text-body">
                    {t('knowledge.textDialog.bodyLabel', 'Body')}
                  </FieldLabel>
                  <Textarea
                    id="knowledge-text-body"
                    className="min-h-56"
                    maxLength={500_000}
                    aria-invalid={isInvalid}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(pending) => (
                <Button disabled={pending} type="submit">
                  {t('knowledge.textDialog.submit', 'Save and index')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
