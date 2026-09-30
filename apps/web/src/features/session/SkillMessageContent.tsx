/**
 * @author Codex
 * @description Presents persisted explicit Pi skill commands with collapsed instructions and the original user prompt.
 */
import { BookOpenIcon, ChevronRightIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useI18n } from '@/i18n/use-i18n';
import { ToolCodeBlock } from './ToolRenderers/ToolRendererParts';
import type { SkillInvocation } from './utils/skill-projection';

/**
 * Keeps the skill body available on demand without mixing it into the user's request text.
 */
export function SkillMessageContent({ skill }: { skill: SkillInvocation }) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Collapsible className="min-w-0">
        <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BookOpenIcon aria-hidden className="size-3.5 shrink-0" />
          <span>{t('session.skill.command', 'Use skill')}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{skill.name}</span>
          <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 group-data-panel-open:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted={false}>
          <div className="flex min-w-0 flex-col gap-2 pt-2">
            <p className="break-all text-xs text-muted-foreground">{skill.path}</p>
            <ToolCodeBlock language="markdown">{skill.instructions}</ToolCodeBlock>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {skill.prompt ? <MarkdownRenderer>{skill.prompt}</MarkdownRenderer> : null}
    </div>
  );
}
