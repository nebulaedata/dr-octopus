/**
 * @author Claude Code
 * @description Confirms irreversible Skill deletion with explicit consequences.
 */
import { Alert } from '@octopus/custom-ui/components/alert';

import { useState } from 'react';

import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { useDeleteSkill } from '@/queries/skills-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { SkillScope } from '@/api/skills';
import type { SkillDto } from '@octopus/shared/protocol';

export interface SkillDeleteDialogProps {
  scope: SkillScope;
  skill: SkillDto | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * Renders the destructive confirmation dialog for deleting one Skill.
 */
export function SkillDeleteDialog({ scope, skill, open, onOpenChange }: SkillDeleteDialogProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const deleteSkill = useDeleteSkill(scope);
  const { t } = useI18n();

  /**
   * Deletes the selected Skill and reports the outcome through the toast channel.
   */
  async function confirm(): Promise<void> {
    if (skill === null) {
      return;
    }
    setSubmitError(null);
    try {
      await deleteSkill.mutateAsync(skill.name);
      toast.add({
        title: t('skills.deleteDialog.deletedTitle', 'Skill deleted'),
        description: t(
          'skills.deleteDialog.deletedDescription',
          'Skill {{name}} has been removed from this machine.',
          {
            name: skill.name,
          }
        ),
        type: 'success',
      });
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t('skills.deleteDialog.failedFallback', 'Deletion failed; please try again later.')
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setSubmitError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('skills.deleteDialog.title', 'Delete skill {{name}}', { name: skill?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t('skills.deleteDialog.irreversible', 'This action cannot be undone.')}
          </DialogDescription>
        </DialogHeader>
        <Alert
          variant="warning"
          showIcon
          description={
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{skill?.name}</span>
              {'. '}
              {t(
                'skills.deleteDialog.warning',
                'This deletes the skill and all {{count}} of its files from {{scope}}; ongoing sessions are unaffected, but new sessions will no longer be able to use it.',
                {
                  count: skill?.fileCount ?? 0,
                  scope:
                    scope.kind === 'global'
                      ? t('skills.deleteDialog.scopeGlobal', 'the user directory on this machine')
                      : t('skills.deleteDialog.scopeWorkspace', 'the current workspace'),
                }
              )}
            </p>
          }
        />
        {submitError !== null && <p className="text-sm font-medium text-destructive">{submitError}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" disabled={deleteSkill.isPending} onClick={() => void confirm()}>
            {deleteSkill.isPending && <Spinner data-icon="inline-start" />}
            {t('skills.common.delete', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
