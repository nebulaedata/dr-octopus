/**
 * @author Claude Code
 * @description Presents one Skill's rendered instructions, metadata, and resource files.
 */

import { FilePenLineIcon, FileIcon, Trash2Icon, TriangleAlertIcon, WandSparklesIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useSkill } from '@/queries/skills-queries';
import { formatRelativeTime } from '@/utils/date';
import { formatBytes } from '@/features/skills/utils/skill-fields';
import { useI18n } from '@/i18n/use-i18n';
import type { SkillScope } from '@/api/skills';

export interface SkillDetailDialogProps {
  scope: SkillScope;
  name: string | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onEdit(name: string): void;
  onDelete(name: string): void;
}

/**
 * Renders the read-only Skill detail dialog with entry points to edit and delete.
 */
export function SkillDetailDialog({
  scope,
  name,
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: SkillDetailDialogProps) {
  const detail = useSkill(scope, name ?? '', open && name !== null);
  const skill = detail.data;
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-base">
            <WandSparklesIcon className="size-4.5 shrink-0 text-primary" />
            <span className="truncate">{name}</span>
            {skill?.disableModelInvocation && (
              <Badge variant="secondary">{t('skills.common.manualInvocation', 'Manual invocation')}</Badge>
            )}
            {skill !== undefined && skill.warnings.length > 0 && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                <TriangleAlertIcon data-icon="inline-start" />
                {t('skills.common.needsFixing', 'Needs fixing')}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {detail.isPending && (
          <div className="flex flex-col gap-3 py-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-56 w-full" />
          </div>
        )}
        {detail.isError && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>{t('skills.detailDialog.loadFailed', 'Failed to load')}</AlertTitle>
            <AlertDescription>
              {detail.error instanceof Error
                ? detail.error.message
                : t('skills.detailDialog.loadFailedFallback', 'Unable to read the skill details.')}
            </AlertDescription>
          </Alert>
        )}
        {skill !== undefined && (
          <div className="flex min-h-0 flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {skill.description ||
                t('skills.detailDialog.noDescription', '(No description yet — edit to add one)')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('skills.common.footerMeta', '{{count}} files · {{size}} · updated {{updated}}', {
                count: skill.fileCount,
                size: formatBytes(skill.sizeBytes),
                updated: formatRelativeTime(skill.updatedAt),
              })}
            </p>
            {skill.warnings.length > 0 && (
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>{t('skills.detailDialog.warningsTitle', 'Loader warnings')}</AlertTitle>
                <AlertDescription>
                  <ul className="list-inside list-disc">
                    {skill.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="rounded-lg border">
              <ScrollArea className="max-h-72">
                <div className="p-4">
                  {skill.body.trim().length > 0 ? (
                    <MarkdownRenderer>{skill.body}</MarkdownRenderer>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('skills.detailDialog.noBody', '(No instructions yet)')}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
            {skill.files.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t('skills.detailDialog.filesTitle', 'Resource files')}
                </h3>
                <ScrollArea className="max-h-28 rounded-lg border">
                  <ul className="p-1.5">
                    {skill.files
                      .filter((file) => file.path !== 'SKILL.md')
                      .map((file) => (
                        <li
                          key={file.path}
                          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted"
                        >
                          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatBytes(file.sizeBytes)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </ScrollArea>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={skill === undefined || name === null}
            onClick={() => name !== null && onDelete(name)}
          >
            <Trash2Icon data-icon="inline-start" />
            {t('skills.common.delete', 'Delete')}
          </Button>
          <Button
            type="button"
            disabled={skill === undefined || name === null}
            onClick={() => name !== null && onEdit(name)}
          >
            <FilePenLineIcon data-icon="inline-start" />
            {t('common.edit', 'Edit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
