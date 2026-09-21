/**
 * @author Codex
 * @description Orchestrates responsive MCP Server selection between catalog and configuration panes.
 */

import { SettingContainer } from '../layout/SettingContainer';
import { useState } from 'react';
import { useResponsive } from 'ahooks';
import { cn } from '@octopus/ui/lib/utils';
import { toast } from '@octopus/ui/components/toast';
import {
  useMcpServer,
  useMcpServerConnectivityProbe,
  useMcpServerMutations,
  useMcpServers,
} from '@/queries/settings-queries';
import { useI18n } from '@/i18n/use-i18n';
import { McpServerCatalog } from './McpServerCatalog';
import { McpServerDetails } from './McpServerDetails';

/** Renders the MCP catalog and configuration pane inside the global Settings navigation. */
export function McpServersPage() {
  const { t } = useI18n();
  const responsive = useResponsive();
  const isDesktop = responsive.md === true;
  const catalog = useMcpServers();
  const mutations = useMcpServerMutations();
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const effectiveSelection = creating
    ? undefined
    : (selected ?? (isDesktop ? catalog.data?.servers[0]?.serverKey : undefined));
  const detail = useMcpServer(effectiveSelection);
  const revision = catalog.data?.revision ?? '';
  const connectivity = useMcpServerConnectivityProbe(catalog.data);
  const mutationError =
    mutations.create.error ?? mutations.update.error ?? mutations.activation.error ?? mutations.remove.error;

  return (
    <SettingContainer mode="full">
      <div className={cn('min-h-0', (creating || effectiveSelection !== undefined) && 'hidden md:block')}>
        <McpServerCatalog
          servers={catalog.data?.servers ?? []}
          selectedServerKey={effectiveSelection}
          pending={catalog.isPending}
          error={catalog.error instanceof Error ? catalog.error.message : undefined}
          connectivity={connectivity.results}
          connectivityPending={connectivity.pendingServerKeys}
          connectivityFailed={connectivity.failedServerKeys}
          onRetry={() => void catalog.refetch()}
          onSelect={(serverKey) => {
            setCreating(false);
            setSelected(serverKey);
          }}
          onCreate={() => {
            setCreating(true);
            setSelected(undefined);
          }}
        />
      </div>
      <div
        className={cn('min-h-0 min-w-0', !creating && effectiveSelection === undefined && 'hidden md:block')}
      >
        <McpServerDetails
          server={detail.data}
          creating={creating}
          pending={!creating && effectiveSelection !== undefined && detail.isPending}
          mutationPending={
            mutations.create.isPending ||
            mutations.update.isPending ||
            mutations.activation.isPending ||
            mutations.remove.isPending
          }
          error={detail.error instanceof Error ? detail.error.message : undefined}
          mutationError={mutationError instanceof Error ? mutationError.message : undefined}
          onBack={() => {
            setCreating(false);
            setSelected(undefined);
          }}
          onRetry={() => void detail.refetch()}
          onCreate={async (name, value) => {
            const result = await mutations.create.mutateAsync({ name, revision, ...value });
            toast.add({
              title: t('settings.mcp.created', 'MCP server created'),
              description: t('settings.mcp.restartDescription', 'Takes effect after restarting the Agent.'),
              type: 'success',
            });
            setCreating(false);
            setSelected(result.server?.serverKey);
            if (result.server !== undefined) {
              await connectivity.probeServer(result.server.serverKey, result.revision);
            }
          }}
          onUpdate={async (serverKey, value) => {
            const result = await mutations.update.mutateAsync({ serverKey, input: { revision, ...value } });
            toast.add({
              title: t('settings.mcp.saved', 'MCP configuration saved'),
              description: t('settings.mcp.restartDescription', 'Takes effect after restarting the Agent.'),
              type: 'success',
            });
            await connectivity.probeServer(serverKey, result.revision);
          }}
          onActivation={async (serverKey, enabled) => {
            const result = await mutations.activation.mutateAsync({
              serverKey,
              input: { enabled, revision },
            });
            await connectivity.probeServer(serverKey, result.revision);
          }}
          onRemove={async (serverKey) => {
            await mutations.remove.mutateAsync({ serverKey, revision });
            setSelected(undefined);
            toast.add({ title: t('settings.mcp.removed', 'MCP configuration removed'), type: 'success' });
          }}
        />
      </div>
    </SettingContainer>
  );
}
