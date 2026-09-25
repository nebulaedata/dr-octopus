/**
 * @author Codex
 * @description Renders searchable Provider navigation independently from Provider detail state.
 */

import { useDeferredValue, useState } from 'react';
import { CheckIcon, PlusIcon, ServerIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { SearchInput } from '@/components/SearchInput';
import { Avatar, AvatarFallback, AvatarImage } from '@octopus/ui/components/avatar';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelProviderSummaryDto } from '@octopus/shared/protocol';

const providerAvatarAssets = [
  { aliases: ['deepseek'], src: '/assets/llm/deepseek.png' },
  { aliases: ['kimi', 'moonshot'], src: '/assets/llm/kimi.png' },
  { aliases: ['openai', 'chatgpt', 'codex'], src: '/assets/llm/openai.png' },
  { aliases: ['anthropic', 'claude'], src: '/assets/llm/claude.png' },
  { aliases: ['github-copilot', 'copilot'], src: '/assets/llm/copilot.png' },
  { aliases: ['google', 'gemini', 'vertex'], src: '/assets/llm/google.png' },
  { aliases: ['huggingface', 'hugging face'], src: '/assets/llm/huggingface.png' },
  { aliases: ['xai', 'grok'], src: '/assets/llm/xai.png' },
  { aliases: ['xiaomi', 'mimo'], src: '/assets/llm/xiaomi.png' },
  { aliases: ['zai', 'z.ai', 'zhipu', 'glm'], src: '/assets/llm/zai.png' },
  { aliases: ['nvidia'], src: '/assets/llm/nvidia.png' },
  { aliases: ['vercel'], src: '/assets/llm/vercel.png' },
  { aliases: ['minimax'], src: '/assets/llm/minimax.png' },
  { aliases: ['openrouter'], src: '/assets/llm/openrouter.png' },
  { aliases: ['qwen'], src: '/assets/llm/qwen.png' },
  { aliases: ['opencode'], src: '/assets/llm/opencode.png' },
] as const;

/**
 * Resolves a bundled Provider avatar from the Provider identity returned by the server.
 */
function getProviderAvatarSrc(provider: ModelProviderSummaryDto): string | undefined {
  if (provider.local) {
    return provider.local.runtime === 'mr-token' ? '/assets/llm/mrtoken.svg' : undefined;
  }
  const identities = [provider.providerId, provider.name].map((value) => value.toLocaleLowerCase());

  return providerAvatarAssets.find(({ aliases }) =>
    aliases.some((alias) => identities.some((identity) => identity.includes(alias)))
  )?.src;
}

export interface ProviderCatalogProps {
  providers: ModelProviderSummaryDto[];
  selectedProviderKey?: string;
  pending: boolean;
  error?: string;
  onSelect(providerKey: string): void;
  onRetry(): void;
  /**
   * Opens the custom provider creation dialog.
   */
  onAdd(): void;
}

/**
 * Presents Provider search, summary rows and query recovery states.
 */
export function ProviderCatalog(props: ProviderCatalogProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const filtered = props.providers.filter((provider) =>
    `${provider.name} ${provider.providerId}`.toLocaleLowerCase().includes(deferredSearch)
  );

  return (
    <section className="flex flex-col h-full min-h-0 min-w-0 border-r overflow-hidden">
      <div className="flex-none p-3">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('settings.providers.searchPlaceholder', 'Search model providers…')}
          aria-label="Search model providers"
        />
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-1 px-2">
          {props.pending &&
            Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          {props.error !== undefined && (
            <Alert variant="destructive">
              <AlertTitle>{t('settings.providers.loadFailed', 'Failed to load model providers')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <span>{props.error}</span>
                <Button variant="outline" size="sm" onClick={props.onRetry}>
                  {t('common.retry', 'Retry')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!props.pending && props.error === undefined && filtered.length === 0 ? (
            <Empty className="min-h-52">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ServerIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {search.length > 0
                    ? t('settings.providers.noMatch', 'No matching results')
                    : t('settings.providers.empty', 'No model providers')}
                </EmptyTitle>
                <EmptyDescription>
                  {search.length > 0
                    ? t('settings.providers.noMatchDescription', 'Try another name or Provider ID.')
                    : t(
                        'settings.providers.emptyDescription',
                        'Use the button below to add a local model provider.'
                      )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {filtered.map((provider) => (
            <button
              key={provider.providerKey}
              type="button"
              className={cn(
                'flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                provider.providerKey === props.selectedProviderKey && 'bg-accent text-accent-foreground'
              )}
              aria-current={provider.providerKey === props.selectedProviderKey ? 'page' : undefined}
              onClick={() => props.onSelect(provider.providerKey)}
            >
              <Avatar className="after:border-0 dark:bg-white">
                <AvatarImage
                  src={getProviderAvatarSrc(provider)}
                  alt={t('settings.providers.avatarAlt', '{{name}} avatar', { name: provider.name })}
                />
                <AvatarFallback className="font-geist font-semibold">
                  {provider.name.slice(0, 1).toLocaleUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium" title={provider.name}>
                  {provider.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {t('settings.providers.modelsAvailableShort', '{{available}}/{{total}} models available', {
                    available: provider.availableModelCount,
                    total: provider.modelCount,
                  })}
                </span>
              </span>
              {provider.auth.configured && (
                <Badge variant="outline" className="text-[11px] bg-success text-white size-4 p-0">
                  <CheckIcon />
                </Badge>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
      <div className="flex-none p-3 flex justify-center">
        <Button variant="outline" size="sm" onClick={props.onAdd}>
          <PlusIcon data-icon="inline-start" />
          {t('settings.providers.addProvider', 'Model provider')}
        </Button>
      </div>
    </section>
  );
}
