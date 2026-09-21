/**
 * @author Codex
 * @description Presents one Skill as an interactive catalog card.
 */

import { EllipsisVerticalIcon, EyeIcon, FilePenLineIcon, Trash2Icon, WandSparklesIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@octopus/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { formatRelativeTime } from '@/utils/date';
import { formatBytes } from './utils';
import { useI18n } from '@/i18n/use-i18n';
import type { SkillDto } from '@octopus/shared/protocol';

export interface SkillCardProps {
  skill: SkillDto;
  onView(name: string): void;
  onEdit(name: string): void;
  onDelete(name: string): void;
}

/**
 * Renders one Skill summary with hover-revealed management actions.
 */
export function SkillCard({ skill, onView, onEdit, onDelete }: SkillCardProps) {
  const { t } = useI18n();
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`View skill ${skill.name}`}
      className="group cursor-pointer gap-3 py-4 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={() => onView(skill.name)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onView(skill.name);
        }
      }}
    >
      <CardHeader className="px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <WandSparklesIcon className="size-4.5" />
          </div>
          <CardTitle className="truncate font-mono text-sm">{skill.name}</CardTitle>
        </div>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More actions for skill ${skill.name}`}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 data-popup-open:opacity-100"
                  onClick={(event) => event.stopPropagation()}
                >
                  <EllipsisVerticalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onClick={() => onView(skill.name)}>
                <EyeIcon data-icon="inline-start" />
                {t('skills.card.viewDetails', 'View details')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(skill.name)}>
                <FilePenLineIcon data-icon="inline-start" />
                {t('common.edit', 'Edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(skill.name)}>
                <Trash2Icon data-icon="inline-start" />
                {t('skills.common.delete', 'Delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="px-4">
        <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{skill.description}</p>
        {(skill.disableModelInvocation || skill.warnings.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {skill.disableModelInvocation && (
              <Badge variant="secondary">{t('skills.common.manualInvocation', 'Manual invocation')}</Badge>
            )}
            {skill.warnings.length > 0 && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                {t('skills.common.needsFixing', 'Needs fixing')}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="px-4 text-xs text-muted-foreground">
        <span className="truncate">
          {t('skills.common.footerMeta', '{{count}} files · {{size}} · updated {{updated}}', {
            count: skill.fileCount,
            size: formatBytes(skill.sizeBytes),
            updated: formatRelativeTime(skill.updatedAt),
          })}
        </span>
      </CardFooter>
    </Card>
  );
}
