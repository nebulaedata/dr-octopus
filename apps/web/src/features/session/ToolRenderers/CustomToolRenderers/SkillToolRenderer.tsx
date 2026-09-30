/**
 * @author Codex
 * @description Presents skill instruction loads independently from ordinary file-read results.
 */
import { BookOpenIcon } from 'lucide-react';
import { useI18n } from '@/i18n/use-i18n';
import { projectSkillRead } from '@/features/session/utils/skill-projection';
import { TruncationNotice } from '../BuiltinToolRenderers';
import { ToolContent, ToolSection } from '../ToolRendererParts';
import type { ToolRendererProps } from '../ToolRendererParts';

/**
 * Preserves the complete read result, including errors and truncated instructions.
 */
export function SkillToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const skill = projectSkillRead(tool);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {skill ? <p className="break-all text-xs text-muted-foreground">{skill.path}</p> : null}
      <ToolSection title={t('session.skill.instructions', 'Skill instructions')} icon={BookOpenIcon}>
        <ToolContent blocks={tool.content} language="markdown" streaming={tool.status === 'running'} />
      </ToolSection>
      <TruncationNotice details={tool.details} />
    </div>
  );
}
