/**
 * @author Codex
 * @description Shows up to four compact quick phrase actions with their bound Agent modes.
 */
import {
  ArrowUpRightIcon,
  AstroidIcon,
  LibraryBigIcon,
  NotebookPenIcon,
  SquareArrowUpRightIcon,
} from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@octopus/ui/components/item';
import { useSnippets } from '@/stores/snippets';
import { useI18n } from '@/i18n/use-i18n';
import type { Snippet } from '@/stores/snippets';

export interface HomeSnippetsProps {
  disabled: boolean;
  /**
   * Applies the saved send or fill behavior with its bound mode.
   */
  onActivate(snippet: Snippet): void;
}

/**
 * Keeps the composer primary while exposing keyboard-accessible single-click starts.
 */
export function HomeSnippets({ disabled, onActivate }: HomeSnippetsProps) {
  const { t } = useI18n();
  const snippets = useSnippets((state) => state.snippets);
  const modes = {
    agent: { label: t('session.workMode.agent', 'Agent'), icon: AstroidIcon },
    plan: { label: t('session.workMode.plan', 'Plan'), icon: NotebookPenIcon },
    knowledge: { label: t('session.knowledgeMode.title', 'Knowledge Q&A'), icon: LibraryBigIcon },
  };
  if (snippets.length === 0) {
    return null;
  }
  return (
    <section aria-label="Quick phrases" className="mt-6">
      <h2 className="mb-3 text-xs font-medium text-muted-foreground">
        {t('settings.snippets.title', 'Quick phrases')}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {snippets.map((snippet) => {
          const mode = modes[snippet.workMode];
          const Icon = mode.icon;
          const ActionIcon = snippet.action === 'fill' ? SquareArrowUpRightIcon : ArrowUpRightIcon;
          return (
            <Item
              variant="outline"
              render={
                <a
                  className="cursor-pointer"
                  type="button"
                  title={snippet.message}
                  onClick={() => onActivate(snippet)}
                  aria-disabled={disabled}
                >
                  <ItemContent>
                    <ItemTitle>
                      <Badge variant="secondary" className="bg-primary/10 text-primary font-serif">
                        <Icon data-icon="inline-start" />
                        {mode.label}
                      </Badge>
                      <span className="line-clamp-1 wrap-break-word">{snippet.title}</span>
                    </ItemTitle>
                    <ItemDescription>
                      <span className="line-clamp-1 wrap-break-word text-xs pt-1">{snippet.message}</span>
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="h-full items-start">
                    <ActionIcon className="size-4 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover/item:-translate-y-0.5 motion-safe:group-hover/item:translate-x-0.5" />
                  </ItemActions>
                </a>
              }
            />
          );
        })}
      </div>
    </section>
  );
}
