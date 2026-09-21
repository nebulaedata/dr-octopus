/**
 * @author Codex
 * @description Renders the authoritative effective Pi Skill catalog and its loading diagnostics.
 */

import { LaptopMinimalIcon, SearchIcon, TriangleAlertIcon, WandSparklesIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
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
import { EffectiveSkillCard } from './EffectiveSkillCard';
import { useI18n } from '@/i18n/use-i18n';
import type { UseQueryResult } from '@tanstack/react-query';
import type { EffectiveSkillCatalogDto, EffectiveSkillDto } from '@octopus/shared/protocol';

export interface EffectiveSkillSectionProps {
  query: UseQueryResult<EffectiveSkillCatalogDto>;
  skills: EffectiveSkillDto[];
  searching: boolean;
}

/**
 * Presents Skills resolved by Pi independently from the narrower Octopus-managed catalogs.
 */
export function EffectiveSkillSection({ query, skills, searching }: EffectiveSkillSectionProps) {
  const { t } = useI18n();
  const totalCount = query.data?.skills.length ?? 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <LaptopMinimalIcon className="size-4.5" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              {t('skills.effectiveSection.title', 'System skills')}
            </h2>
            {query.isSuccess && (
              <>
                <Badge variant="secondary">
                  {searching ? `${skills.length} / ${totalCount}` : totalCount}
                </Badge>
                <Badge variant="outline">
                  {query.data.consistency === 'runtime'
                    ? t('skills.effectiveSection.snapshotRuntime', 'Current session snapshot')
                    : t('skills.effectiveSection.snapshotPreview', 'Agent-resolved preview')}
                </Badge>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              'skills.effectiveSection.description',
              'Read-only skills actually loaded in the current context; switch to a management tab to add or maintain them.'
            )}
          </p>
        </div>
      </div>

      {query.data !== undefined && query.data.diagnostics.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t('skills.effectiveSection.diagnosticsTitle', 'Some skills failed to load')}</AlertTitle>
          <AlertDescription className="text-xs">
            <ul className="list-disc space-y-1 pl-4">
              {query.data.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.type}-${diagnostic.skillName ?? index}-${index}`}>
                  {diagnostic.skillName === undefined
                    ? ''
                    : t('skills.effectiveSection.diagnosticPrefix', '{{name}}: ', { name: diagnostic.skillName })}
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

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
            <EmptyTitle>{t('skills.effectiveSection.loadFailed', 'Failed to load system skills')}</EmptyTitle>
            <EmptyDescription className="text-xs">
              {query.error instanceof Error
                ? query.error.message
                : t(
                    'skills.effectiveSection.loadFailedFallback',
                    'Unable to read the Pi skill list; please try again later.'
                  )}
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
            <EmptyTitle>
              {t('skills.effectiveSection.emptyTitle', 'No skills available in the current context')}
            </EmptyTitle>
            <EmptyDescription className="text-xs">
              {t(
                'skills.effectiveSection.emptyDescription',
                'No effective skills have been resolved in the current context yet.'
              )}
            </EmptyDescription>
          </EmptyHeader>
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
              {t('skills.effectiveSection.noMatchDescription', 'No matches among the system skills.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {skills.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 px-1 py-2">
          {skills.map((skill) => (
            <EffectiveSkillCard key={skill.name} skill={skill} />
          ))}
        </div>
      )}
    </section>
  );
}
