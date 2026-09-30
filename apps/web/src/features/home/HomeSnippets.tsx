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
import { Item, ItemGroup } from '@octopus/ui/components/item';
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
        {t('home.snippets.title', 'Quick start')}
      </h2>
      <ItemGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {snippets.map((snippet) => {
          const mode = modes[snippet.workMode];
          const Icon = mode.icon;
          const ActionIcon = snippet.action === 'fill' ? SquareArrowUpRightIcon : ArrowUpRightIcon;
          return (
            <div key={snippet.id} role="listitem" className="min-w-0">
              <Item
                variant="outline"
                className="h-full flex-nowrap items-start gap-3 rounded-xl p-4 text-left enabled:cursor-pointer enabled:hover:border-primary/40 enabled:hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                render={
                  <button
                    type="button"
                    title={snippet.message}
                    onClick={() => onActivate(snippet)}
                    disabled={disabled}
                  />
                }
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground transition-colors group-[:enabled:hover]/item:bg-primary/10 group-[:enabled:hover]/item:text-primary group-focus-visible/item:bg-primary/10 group-focus-visible/item:text-primary">
                  <Icon aria-hidden="true" className="size-5 text-accent-foreground" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{snippet.title}</span>
                    <span
                      className="shrink-0 text-xs text-muted-foreground flex items-center gap-1"
                      title={
                        snippet.action === 'fill'
                          ? t('home.snippets.fill', 'Click to fill')
                          : t('home.snippets.send', 'Run now')
                      }
                    >
                      {mode.label}
                      <ActionIcon
                        aria-hidden="true"
                        className="size-3.5 motion-safe:transition-transform motion-safe:group-hover/item:-translate-y-0.5 motion-safe:group-hover/item:translate-x-0.5"
                      />
                    </span>
                  </span>
                  <span className="truncate text-xs leading-5 text-muted-foreground">{snippet.message}</span>
                </span>
              </Item>
            </div>
          );
        })}
      </ItemGroup>
    </section>
  );
}
