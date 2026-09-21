/**
 * @author Codex
 * @description Renders one Skill scope section with its own loading, error, empty, and catalog states.
 */

import { PlusIcon, SearchIcon, UploadIcon, WandSparklesIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@octopus/ui/components/empty';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { SkillCard } from './SkillCard';
import { useI18n } from '@/i18n/use-i18n';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SkillCatalogDto, SkillDto } from '@octopus/shared/protocol';

export interface SkillSectionProps {
  title: string;
  description: string;
  /** Absolute Skills directory backing this scope, surfaced so users can locate the files. */
  path?: string;
  icon: ReactNode;
  query: UseQueryResult<SkillCatalogDto>;
  /** Catalog rows after the page-level search filter. */
  skills: SkillDto[];
  /** Whether a search keyword is currently narrowing the catalog. */
  searching: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onCreate(): void;
  onUpload(): void;
  onView(name: string): void;
  onEdit(name: string): void;
  onDelete(name: string): void;
}

/**
 * Presents one scope's catalog so the page can stack Workspace and Global sections independently.
 */
export function SkillSection({
  title,
  description,
  path,
  icon,
  query,
  skills,
  searching,
  emptyTitle,
  emptyDescription,
  onCreate,
  onUpload,
  onView,
  onEdit,
  onDelete,
}: SkillSectionProps) {
  const { t } = useI18n();
  const totalCount = query.data?.skills.length ?? 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {query.isSuccess && (
              <Badge variant="secondary">{searching ? `${skills.length} / ${totalCount}` : totalCount}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex gap-2">
            <span>{path}</span>
            <span>{description}</span>
          </p>
        </div>
      </div>

      {query.isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      )}

      {query.isError && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WandSparklesIcon />
            </EmptyMedia>
            <EmptyTitle>{t('skills.section.loadFailed', 'Failed to load {{title}}', { title })}</EmptyTitle>
            <EmptyDescription className="text-xs">
              {query.error instanceof Error
                ? query.error.message
                : t('skills.section.loadFailedFallback', 'Unable to read the skill list; please try again later.')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('skills.common.reload', 'Reload')}
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {query.isSuccess && totalCount === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WandSparklesIcon />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription className="text-xs">{emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex items-center gap-2">
              <Button onClick={onUpload}>
                <UploadIcon data-icon="inline-start" />
                {t('skills.common.uploadSkill', 'Upload skill')}
              </Button>
              <Button variant="outline" onClick={onCreate}>
                <PlusIcon data-icon="inline-start" />
                {t('skills.section.createManually', 'Create manually')}
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      )}

      {query.isSuccess && totalCount > 0 && skills.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>{t('skills.common.noMatch', 'No matching skills')}</EmptyTitle>
            <EmptyDescription className="text-xs">
              {t('skills.section.noMatchDescription', 'No skills match in this section.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {skills.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 px-1 py-2">
          {skills.map((skill) => (
            <SkillCard key={skill.name} skill={skill} onView={onView} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </section>
  );
}
