/**
 * @author Codex
 * @description Renders searchable MCP configuration navigation with its create action anchored at the bottom.
 */

import { useDeferredValue, useState } from 'react';
import { PlusIcon, ServerIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { SearchInput } from '@/components/SearchInput';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { getMcpServerSourceLabel } from './mcp-server-labels';
import type { Translate } from '@/i18n/use-i18n';
import type {
  McpServerConnectivityDto,
  McpServerConnectivityStatus,
  McpServerSummaryDto,
} from '@octopus/shared/protocol';

export interface McpServerCatalogProps {
  servers: McpServerSummaryDto[];
  selectedServerKey?: string;
  pending: boolean;
  error?: string;
  connectivity: ReadonlyMap<string, McpServerConnectivityDto['servers'][number]>;
  connectivityPending: ReadonlySet<string>;
  connectivityFailed: ReadonlySet<string>;
  onSelect(serverKey: string): void;
  onCreate(): void;
  onRetry(): void;
}

/** Presents MCP search, summary rows, recovery state and bottom create action. */
export function McpServerCatalog(props: McpServerCatalogProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const filtered = props.servers.filter((server) =>
    `${server.name} ${server.transport} ${server.source} ${getMcpServerSourceLabel(t, server.source)}`
      .toLocaleLowerCase()
      .includes(deferredSearch)
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r">
      <div className="flex-none p-3">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('settings.mcp.searchPlaceholder', 'Search MCP servers…')}
          aria-label="Search MCP servers"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 px-2">
          {props.pending &&
            Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          {props.error !== undefined ? (
            <Alert variant="destructive">
              <AlertTitle>{t('settings.mcp.loadFailed', 'Failed to load MCP configuration')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <span>{props.error}</span>
                <Button variant="outline" size="sm" onClick={props.onRetry}>
                  {t('common.retry', 'Retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {!props.pending && props.error === undefined && filtered.length === 0 ? (
            <Empty className="min-h-52">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ServerIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {search.length > 0
                    ? t('settings.mcp.noMatch', 'No matching results')
                    : t('settings.mcp.empty', 'No MCP servers')}
                </EmptyTitle>
                <EmptyDescription>
                  {search.length > 0
                    ? t('settings.mcp.noMatchDescription', 'Try searching by name, transport, or source.')
                    : t('settings.mcp.emptyDescription', 'Use the button below to add the first configuration.')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {filtered.map((server) => (
            <button
              key={server.serverKey}
              type="button"
              className={cn(
                'flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                server.serverKey === props.selectedServerKey && 'bg-accent text-accent-foreground'
              )}
              aria-current={server.serverKey === props.selectedServerKey ? 'page' : undefined}
              onClick={() => props.onSelect(server.serverKey)}
            >
              <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted">
                <ServerIcon className="size-4" />
                {server.enabled && (
                  <ConnectivityDot
                    enabled={server.enabled}
                    status={props.connectivity.get(server.serverKey)?.status}
                    pending={props.connectivityPending.has(server.serverKey)}
                    failed={props.connectivityFailed.has(server.serverKey)}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={server.name}>
                  {server.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {server.transport} · {getMcpServerSourceLabel(t, server.source)}
                </span>
              </span>
              {!server.enabled && (
                <Badge variant="destructive" className="text-[11px]">
                  {t('settings.mcp.badgeDisabled', 'Disabled')}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
      <div className="flex flex-none justify-center p-3">
        <Button variant="outline" size="sm" onClick={props.onCreate}>
          <PlusIcon data-icon="inline-start" />
          {t('settings.mcp.addServer', 'MCP Server')}
        </Button>
      </div>
    </section>
  );
}

interface ConnectivityDotProps {
  enabled: boolean;
  status?: McpServerConnectivityStatus;
  pending: boolean;
  failed: boolean;
}

/** Displays a compact, accessible summary of the latest Host connectivity probe. */
function ConnectivityDot(props: ConnectivityDotProps) {
  const { t } = useI18n();
  const presentation = getConnectivityPresentation(props, t);
  return (
    <span
      role="img"
      aria-label={presentation.label}
      title={presentation.label}
      className={cn(
        'absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-background',
        presentation.className,
        presentation.pulse && 'animate-pulse'
      )}
    />
  );
}

/** Maps probe and activation state to one status-dot presentation. */
function getConnectivityPresentation(
  props: ConnectivityDotProps,
  t: Translate
): {
  label: string;
  className: string;
  pulse?: boolean;
} {
  if (!props.enabled || props.status === 'disabled') {
    return { label: t('settings.mcp.connectivity.disabled', 'Disabled; connectivity not checked'), className: 'bg-muted-foreground/40' };
  }
  if (props.pending || props.status === undefined) {
    return props.failed
      ? { label: t('settings.mcp.connectivity.failed', 'Connectivity check failed'), className: 'bg-destructive' }
      : { label: t('settings.mcp.connectivity.checking', 'Checking connectivity'), className: 'bg-muted-foreground/50', pulse: true };
  }
  if (props.status === 'connected') {
    return { label: t('settings.mcp.connectivity.connected', 'Connected'), className: 'bg-success' };
  }
  if (props.status === 'needs_auth') {
    return {
      label: t('settings.mcp.connectivity.needsAuth', 'Connection failed: authentication required'),
      className: 'bg-destructive',
    };
  }
  return { label: t('settings.mcp.connectivity.failed', 'Connectivity check failed'), className: 'bg-destructive' };
}
