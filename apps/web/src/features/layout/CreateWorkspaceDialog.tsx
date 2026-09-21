/**
 * @author Codex
 * @description Presents a modal dialog for creating a Workspace with TanStack Form and zod validation.
 */

import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Spinner } from '@octopus/ui/components/spinner';
import { useI18n } from '@/i18n/use-i18n';
import type { Translate } from '@/i18n/use-i18n';
import type { WorkspaceDto } from '@octopus/shared/protocol';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Builds the validation schema with localized messages for the current render.
 */
function createWorkspaceSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('layout.workspace.nameRequired', 'Name is required.'))
      .max(100, t('layout.workspace.nameTooLong', 'Name must be 100 characters or less.')),
    slug: z
      .string()
      .trim()
      .refine((value) => value === '' || SLUG_PATTERN.test(value), {
        message: t('layout.workspace.slugInvalid', 'Slug must be lowercase letters, digits, and single hyphens.'),
      }),
  });
}

export interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(input: { name: string; slug?: string }): Promise<WorkspaceDto>;
}

/**
 * Renders a controlled create-workspace dialog with a zod-validated name and optional slug field.
 */
export function CreateWorkspaceDialog(props: CreateWorkspaceDialogProps) {
  const { t } = useI18n();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const form = useForm({
    defaultValues: { name: '', slug: '' },
    validators: {
      onSubmit: createWorkspaceSchema(t),
    },
    onSubmit: async ({ value, formApi }) => {
      setSubmitError(null);
      try {
        await props.onCreate({
          name: value.name.trim(),
          ...(value.slug.trim() === '' ? {} : { slug: value.slug.trim() }),
        });
        props.onOpenChange(false);
        formApi.reset();
      } catch (error) {
        setSubmitError(
          error instanceof Error ? error.message : t('layout.workspace.createFailed', 'Failed to create workspace.')
        );
      }
    },
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open) {
          form.reset();
          setSubmitError(null);
        }
      }}
    >
      <DialogContent initialFocus={() => inputRef.current}>
        <DialogHeader>
          <DialogTitle>{t('layout.workspace.createTitle', 'Create workspace')}</DialogTitle>
          <DialogDescription>
            {t('layout.workspace.createDescription', 'Give the new workspace a name and an optional slug.')}
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-workspace-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field
              name="name"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t('layout.workspace.nameLabel', 'Name')}</FieldLabel>
                    <Input
                      ref={inputRef}
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            />
            <form.Field
              name="slug"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>{t('layout.workspace.slugLabel', 'Slug (optional)')}</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      placeholder={t('layout.workspace.slugPlaceholder', 'auto-generated from name')}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={isInvalid}
                    />
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            />
          </FieldGroup>
          {submitError && <p className="text-sm font-medium text-destructive">{submitError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <form.Subscribe
              selector={(state) => state.isSubmitting}
              children={(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Spinner data-icon="inline-start" />}
                  {t('layout.workspace.create', 'Create')}
                </Button>
              )}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
