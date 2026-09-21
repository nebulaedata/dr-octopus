/**
 * @author Codex
 * @description Presents a modal dialog for renaming a Session with TanStack Form and zod validation.
 */

import { useEffect, useRef, useState } from 'react';
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
import type { SessionDto } from '@octopus/shared/protocol';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Builds the rename validator with localized messages for the active locale.
 */
function createRenameSchema(t: Translate) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('session.rename.titleRequired', 'Title is required.'))
      .max(160, t('session.rename.titleTooLong', 'Title must be 160 characters or less.')),
  });
}

export interface RenameSessionDialogProps {
  session: SessionDto;
  open: boolean;
  /**
   * Controls dialog visibility.
   */
  onOpenChange(open: boolean): void;
  /**
   * Persists the validated Session title.
   */
  onRename(session: SessionDto, title: string): Promise<void>;
}

/**
 * Renders a controlled rename dialog shared by Session navigation and slash commands.
 */
export function RenameSessionDialog(props: RenameSessionDialogProps) {
  const { t } = useI18n();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const form = useForm({
    defaultValues: { title: props.session.title },
    validators: {
      onSubmit: createRenameSchema(t),
    },
    onSubmit: async ({ value }) => {
      const normalized = value.title.trim();
      if (normalized === props.session.title) {
        props.onOpenChange(false);
        return;
      }
      setSubmitError(null);
      try {
        await props.onRename(props.session, normalized);
        props.onOpenChange(false);
      } catch (error) {
        setSubmitError(
          error instanceof Error ? error.message : t('session.rename.failed', 'Failed to rename session.')
        );
      }
    },
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        initialFocus={() => {
          inputRef.current?.select();
          return inputRef.current;
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('session.rename.title', 'Rename session')}</DialogTitle>
          <DialogDescription>
            {t('session.rename.description', 'Enter a new title for this session.')}
          </DialogDescription>
        </DialogHeader>
        <form
          id={`rename-session-form-${props.session.id}`}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field
              name="title"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>
                      {t('session.rename.fieldLabel', 'Title')}
                    </FieldLabel>
                    <Input
                      ref={inputRef}
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={isInvalid}
                    />
                    {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                  </Field>
                );
              }}
            />
          </FieldGroup>
          {submitError === null ? null : (
            <p className="text-sm font-medium text-destructive">{submitError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                props.onOpenChange(false);
                timerRef.current = setTimeout(() => form.reset(), 300);
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <form.Subscribe
              selector={(state) => state.isSubmitting}
              children={(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
                  {t('common.save', 'Save')}
                </Button>
              )}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
