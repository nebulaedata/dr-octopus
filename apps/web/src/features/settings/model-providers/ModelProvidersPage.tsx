/**
 * @author Codex
 * @description Orchestrates URL-owned Provider selection across responsive catalog and detail panes.
 */

import { SettingContainer } from '../Layout/SettingContainer';
import { useEffect, useState } from 'react';
import { AddLocalProviderDialog } from './AddLocalProviderDialog';
import { useResponsive } from 'ahooks';
import { cn } from '@octopus/ui/lib/utils';
import { useModelProvider, useModelProviders } from '@/queries/settings-queries';
import { ProviderCatalog } from './ProviderCatalog';
import { ProviderDetails } from './ProviderDetails';

export interface ModelProvidersPageProps {
  provider?: string;
  /**
   * Synchronizes Provider selection with the active canonical or masked route presentation.
   */
  onProviderChange(provider?: string, options?: { replace?: boolean }): void;
}

/**
 * Renders the model-provider two-pane workspace inside the global Settings navigation.
 */
export function ModelProvidersPage({ provider, onProviderChange }: ModelProvidersPageProps) {
  const responsive = useResponsive();
  const [adding, setAdding] = useState(false);
  const isDesktop = responsive.md === true;
  const catalog = useModelProviders();
  const detail = useModelProvider(provider);

  useEffect(() => {
    const providers = catalog.data?.providers ?? [];
    const initialProvider =
      providers.find((provider) => provider.defaultModelId !== undefined) ??
      providers.find((provider) => provider.availableModelCount > 0) ??
      providers[0];
    if (isDesktop && provider === undefined && initialProvider !== undefined) {
      onProviderChange(initialProvider.providerKey, { replace: true });
    }
  }, [catalog.data?.providers, isDesktop, onProviderChange, provider]);

  return (
    <SettingContainer mode="full">
      <div className={cn('min-h-0', provider !== undefined && 'hidden md:block')}>
        <ProviderCatalog
          providers={catalog.data?.providers ?? []}
          selectedProviderKey={provider}
          pending={catalog.isPending}
          error={catalog.error instanceof Error ? catalog.error.message : undefined}
          onRetry={() => void catalog.refetch()}
          onSelect={onProviderChange}
          onAdd={() => setAdding(true)}
        />
      </div>
      <div className={cn('min-h-0 min-w-0', provider === undefined && 'hidden md:block')}>
        <ProviderDetails
          provider={detail.data}
          pending={provider !== undefined && detail.isPending}
          error={detail.error instanceof Error ? detail.error.message : undefined}
          onBack={() => onProviderChange()}
          onRetry={() => void detail.refetch()}
        />
      </div>
      {adding && <AddLocalProviderDialog onClose={() => setAdding(false)} onCreated={onProviderChange} />}
    </SettingContainer>
  );
}
