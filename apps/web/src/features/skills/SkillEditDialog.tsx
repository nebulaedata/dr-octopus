/**
 * @author Codex
 * @description Presents the structured Skill editor for both creation and modification.
 */

import { useState } from 'react';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@octopus/ui/components/select';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Spinner } from '@octopus/ui/components/spinner';
import { Switch } from '@octopus/ui/components/switch';
import { Textarea } from '@octopus/ui/components/textarea';
import { toast } from '@octopus/ui/components/toast';
import { useCreateSkill, useSkill, useUpdateSkill } from '@/queries/skills-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { Translate } from '@/i18n/use-i18n';
import type { SkillEditorInput, SkillScope } from '@/api/skills';

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Builds the editor schema with localized validation messages.
 */
function skillEditorSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('skills.editDialog.nameRequired', 'Enter a skill name.'))
      .max(64, t('skills.editDialog.nameTooLong', 'The name must be at most 64 characters.'))
      .regex(
        SKILL_NAME_PATTERN,
        t(
          'skills.editDialog.namePattern',
          'The name may only contain lowercase letters, digits, and single hyphens.'
        )
      ),
    description: z
      .string()
      .trim()
      .min(1, t('skills.editDialog.descriptionRequired', 'Enter a skill description.'))
      .max(
        1024,
        t('skills.editDialog.descriptionTooLong', 'The description must be at most 1024 characters.')
      ),
    disableModelInvocation: z.boolean(),
    body: z.string(),
  });
}

export interface SkillEditDialogProps {
  mode: 'create' | 'edit';
  scope: SkillScope;
  name?: string;
  /** Workspace display name used by the create-mode scope selector. */
  workspaceName?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Create-mode scope switch; edit mode keeps the Skill's original scope. */
  onScopeKindChange?(kind: SkillScope['kind']): void;
}

/**
 * Renders the create or edit dialog; edit mode loads the current Skill before showing the form.
 */
export function SkillEditDialog({
  mode,
  scope,
  name,
  workspaceName,
  open,
  onOpenChange,
  onScopeKindChange,
}: SkillEditDialogProps) {
  const detail = useSkill(scope, name ?? '', open && mode === 'edit' && name !== undefined);
  const { t } = useI18n();

  /**
   * Selects dialog description content in the existing condition order.
   */
  function renderDialogDescriptionContent() {
    if (scope.kind === 'global') {
      return t(
        'skills.editDialog.descriptionGlobal',
        'The skill is saved as SKILL.md in the user directory on this machine and takes effect for new sessions in all workspaces.'
      );
    } else if (workspaceName === undefined) {
      return t(
        'skills.editDialog.descriptionWorkspace',
        "The skill is saved as SKILL.md in the current workspace's .dr-octopus/skills directory and takes effect only for new sessions in that workspace."
      );
    } else {
      return t(
        'skills.editDialog.descriptionWorkspaceNamed',
        'The skill is saved as SKILL.md in the current workspace\'s .dr-octopus/skills directory and takes effect only for new sessions in workspace "{{name}}".',
        { name: workspaceName }
      );
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? t('skills.page.newSkill', 'New skill')
              : t('skills.editDialog.titleEdit', 'Edit skill {{name}}', { name: name ?? '' })}
          </DialogTitle>
          <DialogDescription>{renderDialogDescriptionContent()}</DialogDescription>
        </DialogHeader>
        {mode === 'edit' && detail.isPending && (
          <div className="flex flex-col gap-4 py-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}
        {mode === 'edit' && detail.isError && (
          <p className="py-4 text-sm font-medium text-destructive">
            {detail.error instanceof Error
              ? detail.error.message
              : t('skills.editDialog.loadFailedFallback', 'Failed to load the skill details.')}
          </p>
        )}
        {(mode === 'create' || detail.data !== undefined) && (
          <SkillEditForm
            key={mode === 'edit' ? `${scope.kind}:${name ?? ''}:${detail.data?.updatedAt ?? ''}` : 'create'}
            mode={mode}
            scope={scope}
            name={name}
            workspaceName={workspaceName}
            defaultValues={
              mode === 'edit' && detail.data !== undefined
                ? {
                    name: detail.data.name,
                    description: detail.data.description,
                    disableModelInvocation: detail.data.disableModelInvocation,
                    body: detail.data.body,
                  }
                : undefined
            }
            onScopeKindChange={onScopeKindChange}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SkillEditFormProps {
  mode: 'create' | 'edit';
  scope: SkillScope;
  name?: string;
  workspaceName?: string;
  defaultValues?: SkillEditorInput;
  onScopeKindChange?(kind: SkillScope['kind']): void;
  onDone(): void;
}

/**
 * Owns the validated editor form and submits through the matching Skill mutation.
 */
function SkillEditForm({
  mode,
  scope,
  name,
  workspaceName,
  defaultValues,
  onScopeKindChange,
  onDone,
}: SkillEditFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const createSkill = useCreateSkill(scope);
  const updateSkill = useUpdateSkill(scope);
  const { t } = useI18n();
  const schema = skillEditorSchema(t);
  const form = useForm({
    defaultValues: defaultValues ?? {
      name: '',
      description: '',
      disableModelInvocation: false,
      body: '',
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const input: SkillEditorInput = {
        name: value.name.trim(),
        description: value.description.trim(),
        disableModelInvocation: value.disableModelInvocation,
        body: value.body,
      };
      try {
        if (mode === 'create') {
          await createSkill.mutateAsync(input);
        } else {
          await updateSkill.mutateAsync({ name: name ?? input.name, input });
        }
        toast.add({
          title:
            mode === 'create'
              ? t('skills.editDialog.createdTitle', 'Skill created')
              : t('skills.editDialog.savedTitle', 'Skill saved'),
          description: t('skills.common.effectiveNote', 'Skill {{name}} will take effect in new sessions.', {
            name: input.name,
          }),
          type: 'success',
        });
        onDone();
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : t('skills.editDialog.saveFailedFallback', 'Failed to save the skill; please try again later.')
        );
      }
    },
  });

  return (
    <form
      id="skill-editor-form"
      className="flex min-h-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        {mode === 'create' && onScopeKindChange !== undefined && (
          <Field>
            <FieldLabel htmlFor="skill-scope">{t('skills.common.scope', 'Scope')}</FieldLabel>
            <Select
              value={scope.kind}
              onValueChange={(value) => onScopeKindChange(value === 'global' ? 'global' : 'workspace')}
            >
              <SelectTrigger id="skill-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">
                  {workspaceName === undefined
                    ? t('skills.common.scopeWorkspaceItem', 'Workspace skill')
                    : t('skills.common.scopeWorkspaceItemNamed', 'Workspace skill ({{name}})', {
                        name: workspaceName,
                      })}
                </SelectItem>
                <SelectItem value="global">
                  {t('skills.common.scopeGlobalItem', 'Global skill (all workspaces)')}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              {t(
                'skills.editDialog.scopeNote',
                'The effective result of same-named resources is resolved uniformly by Pi; confirm it under "System skills".'
              )}
            </FieldDescription>
          </Field>
        )}
        {mode === 'create' && (
          <form.Field
            name="name"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>{t('skills.editDialog.nameLabel', 'Name')}</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    placeholder={t('skills.editDialog.namePlaceholder', 'e.g. deep-research')}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={isInvalid}
                  />
                  <FieldDescription>
                    {t(
                      'skills.editDialog.nameHint',
                      'Lowercase letters, digits, and single hyphens; cannot be changed after creation.'
                    )}
                  </FieldDescription>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        )}
        <form.Field
          name="description"
          children={(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>
                  {t('skills.editDialog.descriptionLabel', 'Description')}
                </FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  rows={2}
                  placeholder={t(
                    'skills.editDialog.descriptionPlaceholder',
                    'Describe in a sentence or two what this skill is good at and when to use it.'
                  )}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={isInvalid}
                />
                <FieldDescription>
                  {field.state.value.length}
                  {' / 1024'}
                </FieldDescription>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        />
        <form.Field
          name="disableModelInvocation"
          children={(field) => (
            <Field className="flex flex-row items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={field.name}>
                  {t('skills.editDialog.manualOnlyLabel', 'Manual invocation only')}
                </FieldLabel>
                <FieldDescription>
                  {t(
                    'skills.editDialog.manualOnlyHint',
                    'When enabled, the skill is not included in model prompts and can only be invoked explicitly via /skill:{{name}}.',
                    { name: name ?? 'name' }
                  )}
                </FieldDescription>
              </div>
              <Switch
                id={field.name}
                name={field.name}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        />
        <form.Field
          name="body"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>
                {t('skills.editDialog.bodyLabel', 'Instructions (Markdown)')}
              </FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                rows={10}
                className="max-h-72 resize-none overflow-y-auto font-mono text-xs"
                placeholder={t(
                  'skills.editDialog.bodyPlaceholder',
                  '# Usage\n\nWrite the steps, constraints, and examples the Agent should follow when executing this skill.'
                )}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        />
      </FieldGroup>
      {submitError && <p className="text-sm font-medium text-destructive">{submitError}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDone()}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              {mode === 'create' ? t('skills.editDialog.createSubmit', 'Create') : t('common.save', 'Save')}
            </Button>
          )}
        />
      </DialogFooter>
    </form>
  );
}
