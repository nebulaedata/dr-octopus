/**
 * @author Codex
 * @description Presents one resolved Pi Skill with provenance and ownership metadata.
 */

import { PackageIcon, WandSparklesIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { useI18n } from '@/i18n/use-i18n';
import type { Translate } from '@/i18n/use-i18n';
import type { EffectiveSkillDto } from '@octopus/shared/protocol';

export interface EffectiveSkillCardProps {
  skill: EffectiveSkillDto;
}

/**
 * Localizes the resolution-scope badge while preserving the exact scope union.
 */
function scopeLabel(t: Translate, scope: EffectiveSkillDto['scope']): string {
  switch (scope) {
    case 'user':
      return t('skills.effectiveCard.scope.user', 'User-level');
    case 'project':
      return t('skills.effectiveCard.scope.project', 'Project-level');
    case 'temporary':
      return t('skills.effectiveCard.scope.temporary', 'Temporary');
  }
}

/**
 * Localizes known discovery sources and passes unfamiliar ones through unchanged.
 */
function sourceLabel(t: Translate, source: string): string {
  switch (source) {
    case 'auto':
      return t('skills.effectiveCard.source.auto', 'Discovered automatically');
    case 'local':
      return t('skills.effectiveCard.source.local', 'Local configuration');
    case 'cli':
      return t('skills.effectiveCard.source.cli', 'Specified via CLI');
    default:
      return source;
  }
}

/**
 * Renders one read-only effective Skill without implying that every source is editable by Octopus.
 */
export function EffectiveSkillCard({ skill }: EffectiveSkillCardProps) {
  const { t } = useI18n();
  let managedLabel: string | undefined;
  if (skill.managedScope === 'workspace') {
    managedLabel = t('skills.effectiveCard.managed.workspace', 'Managed by workspace');
  } else if (skill.managedScope === 'global') {
    managedLabel = t('skills.effectiveCard.managed.global', 'Managed globally');
  } else {
    managedLabel = undefined;
  }
  const sourceText =
    skill.origin === 'package'
      ? t('skills.effectiveCard.originPackage', 'Provided by extension package')
      : sourceLabel(t, skill.source);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {skill.origin === 'package' ? (
              <PackageIcon className="size-4.5" />
            ) : (
              <WandSparklesIcon className="size-4.5" />
            )}
          </div>
          <CardTitle className="truncate font-geist text-sm" title={skill.name}>
            {skill.name}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{skill.description}</p>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-1.5 px-4">
        <Badge variant="secondary">{scopeLabel(t, skill.scope)}</Badge>
        <Badge variant="outline" className="bg-accent text-accent-foreground border-accent-foreground/15">
          {sourceText}
        </Badge>
        {managedLabel !== undefined && <Badge>{managedLabel}</Badge>}
      </CardFooter>
    </Card>
  );
}
