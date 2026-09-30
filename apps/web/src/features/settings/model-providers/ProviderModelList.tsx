/**
 * @author Codex
 * @description Displays every provider model inline in the existing settings detail.
 */
import { AstroidIcon, CircleSlashIcon, ImageIcon, LightbulbIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@octopus/ui/components/item';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useI18n } from '@/i18n/use-i18n';
import { ModelAssociationDialog } from './ModelAssociationDialog';
import type { ModelProviderDetailDto } from '@octopus/shared/protocol';

/**
 * Renders one model with the same capability actions and availability indicators as the detail page.
 */
function ProviderModelRow({
  provider,
  model,
}: {
  provider: ModelProviderDetailDto;
  model: ModelProviderDetailDto['models'][number];
}) {
  const { t } = useI18n();
  const adaptationReasons = {
    not_found: t('settings.providers.adaptation.not_found', 'Model unavailable: no built-in model match'),
    ambiguous: t('settings.providers.adaptation.ambiguous', 'Model unavailable: ambiguous original provider'),
    incomplete: t(
      'settings.providers.adaptation.incomplete',
      'Model unavailable: incomplete compatibility configuration'
    ),
  };
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <AstroidIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="text-xs">{model.name}</ItemTitle>
        <ItemDescription className="truncate text-xs">
          {model.modelId}
          {model.api && <> · {model.api}</>}
          {model.contextWindow !== undefined && (
            <>
              {' · '}
              {t('settings.providers.contextWindowShort', '{{size}} context', {
                size: new Intl.NumberFormat('en', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(model.contextWindow),
              })}
            </>
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="flex-wrap justify-end">
        {model.capabilities.includes('reasoning') && (
          <Tooltip>
            <TooltipTrigger aria-label="Reasoning">
              <Badge variant="secondary">
                <LightbulbIcon />
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {t('settings.providers.reasoning', 'Reasoning')}
            </TooltipContent>
          </Tooltip>
        )}
        {model.capabilities.includes('image_input') && (
          <Tooltip>
            <TooltipTrigger aria-label="Image input">
              <Badge variant="secondary">
                <ImageIcon />
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {t('settings.providers.imageInput', 'Image input')}
            </TooltipContent>
          </Tooltip>
        )}
        {model.isDefault && (
          <Badge className="text-[11px]">{t('settings.providers.defaultBadge', 'Default')}</Badge>
        )}
        {!model.available && (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive">
                <CircleSlashIcon />
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              {model.adaptation?.status === 'unadapted'
                ? adaptationReasons[model.adaptation.reason]
                : t('settings.providers.unavailable', 'Model unavailable')}
            </TooltipContent>
          </Tooltip>
        )}
        {provider.local?.runtime === 'mr-token' && (
          <ModelAssociationDialog providerKey={provider.providerKey} model={model} />
        )}
      </ItemActions>
    </Item>
  );
}

/**
 * Renders the complete model catalog in the detail page's existing scroll flow.
 */
export function ProviderModelList({ provider }: { provider: ModelProviderDetailDto }) {
  return (
    <ItemGroup>
      {provider.models.map((model) => (
        <ProviderModelRow key={model.modelKey} provider={provider} model={model} />
      ))}
    </ItemGroup>
  );
}
