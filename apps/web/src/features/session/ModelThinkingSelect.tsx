/**
 * @author Codex
 * @description Combines Session model and reasoning-effort selection in one compact Composer menu.
 */

import { BotIcon, BrainCircuitIcon, ChevronDownIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { useI18n } from '@/i18n/use-i18n';
import { cn } from '@octopus/ui/lib/utils';
import { modelProvidersQueryOptions } from '@/queries/settings-queries';
import type { ModelDto, ThinkingLevel } from '@octopus/shared/protocol';

export interface ModelThinkingSelectProps {
  mobile?: boolean;
  disabled?: boolean;
  models: ModelDto[];
  open?: boolean;
  /**
   * Controls the combined selector from toolbar and slash-command interactions.
   */
  onOpenChange?(open: boolean): void;
  modelValue: string | null;
  followDefault?: boolean;
  /**
   * Restores the draft's default-model selection intent.
   */
  onFollowDefault?(): void;
  thinkingLevels: ThinkingLevel[];
  thinkingValue: ThinkingLevel;
  /**
   * Updates the selected model.
   */
  onModelValueChange(value: string): void;
  /**
   * Updates the selected reasoning-effort level.
   */
  onThinkingValueChange(value: ThinkingLevel): void;
}

/**
 * Renders one toolbar trigger with model and thinking-level submenus.
 */
export function ModelThinkingSelect({
  mobile = false,
  disabled = false,
  models,
  open,
  onOpenChange,
  modelValue,
  followDefault,
  onFollowDefault,
  thinkingLevels,
  thinkingValue,
  onModelValueChange,
  onThinkingValueChange,
}: ModelThinkingSelectProps) {
  const { t } = useI18n();
  const providerCatalog = useQuery({ ...modelProvidersQueryOptions, enabled: open !== false });
  const providerNames = new Map(
    providerCatalog.data?.providers.map((provider) => [provider.providerId, provider.name]) ?? []
  );
  const modelItems = models.map((model) => ({
    value: `${model.provider}/${model.id}`,
    label: model.name,
    provider: model.provider,
  }));
  const groupedModels = new Map<string, typeof modelItems>();
  for (const model of modelItems) {
    const group = groupedModels.get(model.provider) ?? [];
    group.push(model);
    groupedModels.set(model.provider, group);
  }
  const selectedModel = modelItems.find((model) => model.value === modelValue);

  /**
   * Narrows the Base UI radio value before updating the model contract.
   */
  function handleModelValueChange(value: unknown): void {
    if (value === 'follow-default' && onFollowDefault) {
      onFollowDefault();
      return;
    }
    if (typeof value === 'string' && modelItems.some((model) => model.value === value)) {
      onModelValueChange(value);
    }
  }

  /**
   * Narrows the Base UI radio value before updating the thinking-level contract.
   */
  function handleThinkingValueChange(value: unknown): void {
    if (typeof value === 'string' && thinkingLevels.includes(value as ThinkingLevel)) {
      onThinkingValueChange(value as ThinkingLevel);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size={mobile ? 'icon' : 'sm'}
            className={cn('h-8 min-w-0', mobile ? 'shrink-0' : 'max-w-48 shrink gap-1.5')}
            title={selectedModel?.label ?? t('session.modelThinking.chooseModel', 'Choose model')}
            aria-label="Model and thinking settings"
          />
        }
      >
        <BotIcon data-icon="inline-start" />
        <span
          className={cn('max-w-32 truncate text-xs', mobile && 'hidden')}
          title={selectedModel?.label ?? t('session.modelThinking.chooseModel', 'Choose model')}
        >
          {selectedModel?.label ?? t('session.modelThinking.chooseModel', 'Choose model')}
        </span>
        {!mobile && <ChevronDownIcon data-icon="inline-end" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <BotIcon data-icon="inline-start" />
              <span>{t('session.modelThinking.model', 'Model')}</span>
              <span
                className="ml-auto max-w-28 truncate text-xs text-muted-foreground"
                title={selectedModel?.label ?? t('session.modelThinking.notSelected', 'Not selected')}
              >
                {selectedModel?.label ?? t('session.modelThinking.notSelected', 'Not selected')}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56 overflow-hidden">
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  value={followDefault ? 'follow-default' : (modelValue ?? '')}
                  onValueChange={handleModelValueChange}
                >
                  {onFollowDefault && (
                    <>
                      <DropdownMenuRadioItem value="follow-default">
                        {t('session.modelThinking.followDefault', 'Follow default model')}
                      </DropdownMenuRadioItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <ScrollArea
                    aria-label="Models by provider"
                    className="*:data-[slot=scroll-area-viewport]:max-h-72"
                  >
                    {[...groupedModels.entries()].map(([providerId, providerModels], index) => (
                      <DropdownMenuGroup key={providerId}>
                        {index > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel className="sticky top-0 z-10 bg-popover font-geist">
                          {providerNames.get(providerId) ?? providerId}
                        </DropdownMenuLabel>
                        {providerModels.map((model) => (
                          <DropdownMenuRadioItem key={model.value} value={model.value}>
                            <span className="max-w-52 truncate" title={model.label}>
                              {model.label}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuGroup>
                    ))}
                  </ScrollArea>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <BrainCircuitIcon data-icon="inline-start" />
              <span>{t('session.modelThinking.thinkingLevel', 'Thinking')}</span>
              <span className="ml-auto text-xs text-muted-foreground">{thinkingValue}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-40">
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup value={thinkingValue} onValueChange={handleThinkingValueChange}>
                  {thinkingLevels.map((level) => (
                    <DropdownMenuRadioItem key={level} value={level}>
                      {level}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
