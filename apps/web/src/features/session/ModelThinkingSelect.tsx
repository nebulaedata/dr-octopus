/**
 * @author Codex
 * @description Combines Session model and reasoning-effort selection in one compact Composer menu.
 */

import { BotIcon, BrainCircuitIcon, ChevronDownIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelDto, ThinkingLevel } from '@octopus/shared/protocol';

export interface ModelThinkingSelectProps {
  disabled?: boolean;
  models: ModelDto[];
  open?: boolean;
  /**
   * Controls the combined selector from toolbar and slash-command interactions.
   */
  onOpenChange?(open: boolean): void;
  modelValue: string | null;
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
  disabled = false,
  models,
  open,
  onOpenChange,
  modelValue,
  thinkingLevels,
  thinkingValue,
  onModelValueChange,
  onThinkingValueChange,
}: ModelThinkingSelectProps) {
  const { t } = useI18n();
  const modelItems = models.map((model) => ({
    value: `${model.provider}/${model.id}`,
    label: model.name,
  }));
  const selectedModel = modelItems.find((model) => model.value === modelValue);

  /**
   * Narrows the Base UI radio value before updating the model contract.
   */
  function handleModelValueChange(value: unknown): void {
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
            size="sm"
            className="flex h-8 w-8 shrink-0 gap-0 px-0 md:h-7 md:w-auto md:max-w-48 md:gap-1.5 md:px-2.5"
            title={selectedModel?.label ?? t('session.modelThinking.chooseModel', 'Choose model')}
            aria-label="Model and thinking settings"
          />
        }
      >
        <BotIcon data-icon="inline-start" className="size-4 md:size-3.5" />
        <span
          className="hidden max-w-32 truncate text-xs md:inline"
          title={selectedModel?.label ?? t('session.modelThinking.chooseModel', 'Choose model')}
        >
          {selectedModel?.label ?? t('session.modelThinking.chooseModel', 'Choose model')}
        </span>
        <ChevronDownIcon data-icon="inline-end" className="hidden md:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={models.length === 0}>
              <BotIcon data-icon="inline-start" />
              <span>{t('session.modelThinking.model', 'Model')}</span>
              <span
                className="ml-auto max-w-28 truncate text-xs text-muted-foreground"
                title={selectedModel?.label ?? t('session.modelThinking.notSelected', 'Not selected')}
              >
                {selectedModel?.label ?? t('session.modelThinking.notSelected', 'Not selected')}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup value={modelValue ?? ''} onValueChange={handleModelValueChange}>
                  {modelItems.map((model) => (
                    <DropdownMenuRadioItem key={model.value} value={model.value}>
                      <span className="max-w-52 truncate" title={model.label}>
                        {model.label}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={thinkingLevels.length === 0}>
              <BrainCircuitIcon data-icon="inline-start" />
              <span>{t('session.modelThinking.thinkingLevel', 'Thinking level')}</span>
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
