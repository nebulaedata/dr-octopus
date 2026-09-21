/**
 * @author Codex
 * @description Presents Provider authentication, endpoint and model snapshot details.
 */

import { AstroidIcon, ImageIcon, ServerIcon, LightbulbIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { Field, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@octopus/ui/components/item';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { ProviderAuthForm } from './ProviderAuthForm';
import { ModelCapabilitiesDialog } from './ModelCapabilitiesDialog';
import { LocalProviderForm } from './LocalProviderForm';
import { useI18n } from '@/i18n/use-i18n';
import type { ModelProviderDetailDto } from '@octopus/shared/protocol';

export interface ProviderDetailsProps {
  provider?: ModelProviderDetailDto;
  pending: boolean;
  error?: string;
  onBack(): void;
  onRetry(): void;
}

/**
 * Renders the selected Provider and preserves honest unsupported-action boundaries.
 */
export function ProviderDetails(props: ProviderDetailsProps) {
  const { t } = useI18n();
  if (props.pending) {
    return (
      <div className="flex h-full flex-col gap-5 p-5">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (props.error !== undefined) {
    return (
      <div className="p-5">
        <Alert variant="destructive">
          <AlertTitle>{t('settings.providers.detailsLoadFailed', 'Failed to load provider details')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{props.error}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={props.onBack}>
                {t('settings.providers.backToList', 'Back to list')}
              </Button>
              <Button onClick={props.onRetry}>{t('common.retry', 'Retry')}</Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (props.provider === undefined) {
    return (
      <Empty className="h-full rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ServerIcon />
          </EmptyMedia>
          <EmptyTitle>{t('settings.providers.selectTitle', 'Select a model provider')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'settings.providers.selectDescription',
              'Pick one from the catalog to view authentication status, endpoint, and model capabilities.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const provider = props.provider;
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-6">
        <header className="flex min-w-0 items-start gap-3 border-b pb-3">
          <Button variant="ghost" size="sm" className="md:hidden" onClick={props.onBack}>
            {t('common.back', 'Back')}
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{provider.name}</h2>
              <Badge variant="outline">{provider.provenance}</Badge>
              {provider.local ? (
                <Badge variant="secondary">
                  {provider.modelCount > 0
                    ? t('settings.providers.configured', 'Configured')
                    : t('settings.providers.pendingConfiguration', 'Pending configuration')}
                </Badge>
              ) : provider.auth.configured ? (
                <Badge variant="secondary" className="bg-success text-white">
                  {t('settings.providers.authenticated', 'Authenticated')}
                </Badge>
              ) : (
                <Badge variant="outline">{t('settings.providers.unauthenticated', 'Not authenticated')}</Badge>
              )}
            </div>
            <p className="truncate text-sm text-muted-foreground">{provider.providerId}</p>
          </div>
        </header>
        {provider.local ? (
          <LocalProviderForm
            key={provider.providerKey}
            providerKey={provider.providerKey}
            configuration={provider.local}
          />
        ) : (
          <>
            <section className="flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.providers.authTitle', 'Authentication')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('settings.providers.authDescription', 'Choose the provider authentication method')}
                </p>
              </div>
              {provider.auth.sourceLabel === undefined ? null : (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{provider.auth.sourceLabel}</Badge>
                </div>
              )}
              {provider.auth.methods.length > 0 ? (
                <ProviderAuthForm
                  key={`${provider.providerKey}:${provider.auth.configured}:${provider.auth.activeMethod ?? 'none'}:${provider.auth.source ?? 'none'}`}
                  provider={provider}
                />
              ) : (
                <Alert>
                  <AlertTitle>
                    {t('settings.providers.authEnvManagedTitle', 'Authentication managed by the runtime environment')}
                  </AlertTitle>
                  <AlertDescription>
                    {t(
                      'settings.providers.authEnvManagedDescription',
                      'This provider has no authentication method editable on this page.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </section>
            <section className="flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.providers.endpointTitle', 'Endpoint')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('settings.providers.endpointDescription', 'API access address of the model provider')}
                </p>
              </div>
              {provider.endpoint && (
                <Field>
                  <FieldLabel htmlFor="provider-endpoint" className="text-xs text-muted-foreground">
                    {t('settings.providers.apiAddress', 'API address')}
                    {provider.capabilities.endpoint === 'readonly'
                      ? t('settings.providers.readonlySuffix', ' (readonly)')
                      : ''}
                  </FieldLabel>
                  <Input
                    id="provider-endpoint"
                    value={provider.endpoint.effectiveBaseUrl}
                    readOnly={provider.capabilities.endpoint === 'readonly'}
                  />
                </Field>
              )}
            </section>
          </>
        )}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{t('settings.providers.modelsTitle', 'Models')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('settings.providers.modelsAvailable', '{{available}} of {{total}} models currently available', {
                  available: provider.availableModelCount,
                  total: provider.modelCount,
                })}
              </p>
            </div>
            <Badge variant="secondary">{provider.modelCount}</Badge>
          </div>
          <ItemGroup>
            {provider.models.map((model) => (
              <Item key={model.modelKey} variant="outline" size="sm">
                <ItemMedia variant="icon">
                  <AstroidIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="text-xs">{model.name}</ItemTitle>
                  <ItemDescription className="truncate text-xs">
                    {model.modelId} · {model.api}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="flex-wrap justify-end">
                  {provider.provenance === 'models_json' && (
                    <ModelCapabilitiesDialog providerKey={provider.providerKey} model={model} />
                  )}
                  {model.reasoning && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="secondary">
                          <LightbulbIcon />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        {t('settings.providers.reasoning', 'Supports reasoning')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {model.input.includes('image') && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="secondary">
                          <ImageIcon />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        {t('settings.providers.imageInput', 'Supports image input')}
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
                          <XIcon />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        {t('settings.providers.unavailable', 'Model unavailable')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </section>
      </div>
    </ScrollArea>
  );
}
