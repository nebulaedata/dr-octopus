/**
 * @author Codex
 * @description Renders the selected MCP configuration or creation form in the Settings detail pane.
 */

import { useState } from 'react';
import { ArrowLeftIcon, ServerIcon, Trash2Icon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Spinner } from '@octopus/ui/components/spinner';
import { Switch } from '@octopus/ui/components/switch';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { McpServerForm } from './McpServerForm';
import { getMcpServerSourceLabel } from '@/features/settings/utils/mcp-server-labels';
import { Separator } from '@octopus/ui/components/separator';
import type { McpServerConfigurationInput, McpServerDetailDto } from '@octopus/shared/protocol';

export interface McpServerDetailsProps {
  server?: McpServerDetailDto;
  creating: boolean;
  pending: boolean;
  mutationPending: boolean;
  error?: string;
  mutationError?: string;
  onBack(): void;
  onRetry(): void;
  onCreate(name: string, value: McpServerConfigurationInput): Promise<void>;
  onUpdate(serverKey: string, value: McpServerConfigurationInput): Promise<void>;
  onActivation(serverKey: string, enabled: boolean): Promise<void>;
  onRemove(serverKey: string): Promise<void>;
}

/** Presents one independently scrollable MCP configuration pane. */
export function McpServerDetails(props: McpServerDetailsProps) {
  const { t } = useI18n();
  const [removeOpen, setRemoveOpen] = useState(false);
  if (props.pending) {
    return (
      <div className="flex h-full flex-col gap-5 p-5">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (props.error !== undefined) {
    return (
      <div className="p-5">
        <Alert variant="destructive">
          <AlertTitle>{t('settings.mcp.operationFailed', 'MCP operation failed')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{props.error}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={props.onBack}>
                {t('settings.mcp.backToList', 'Back to list')}
              </Button>
              <Button onClick={props.onRetry}>{t('common.retry', 'Retry')}</Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!props.creating && props.server === undefined) {
    return (
      <Empty className="h-full rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ServerIcon />
          </EmptyMedia>
          <EmptyTitle>{t('settings.mcp.selectTitle', 'Select an MCP server')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'settings.mcp.selectDescription',
              'Pick one from the catalog to view its source, connection, and tool exposure.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const server = props.server;
  /**
   * Selects renderdiv content in the existing condition order.
   */
  function renderContent() {
    if (props.creating) {
      return (
        <section className="flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold">{t('settings.mcp.connectionTitle', 'Connection')}</h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'settings.mcp.connectionCreateDescription',
                'Add a local process, HTTP, or Socket MCP server.'
              )}
            </p>
          </div>
          <McpServerForm pending={props.mutationPending} onSubmit={props.onCreate} />
        </section>
      );
    } else if (server) {
      return (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.mcp.enableTitle', 'Enable server')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'settings.mcp.enableDescription',
                    'Does not start or stop the current Agent Runtime; restart the Agent after saving.'
                  )}
                </p>
              </div>
              <Switch
                checked={server.enabled}
                disabled={!server.capabilities.toggle || props.mutationPending}
                onCheckedChange={(enabled) => void props.onActivation(server.serverKey, enabled)}
              />
            </div>
          </section>
          <section className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold">{t('settings.mcp.connectionTitle', 'Connection')}</h3>
              <p className="text-xs text-muted-foreground">
                {t(
                  'settings.mcp.connectionEditDescription',
                  'Local process, HTTP, or Socket MCP server configuration.'
                )}
              </p>
            </div>
            {server.capabilities.edit ? (
              <McpServerForm
                server={server}
                pending={props.mutationPending}
                onSubmit={(_name, value) => props.onUpdate(server.serverKey, value)}
              />
            ) : (
              <Alert>
                <AlertTitle>{t('settings.mcp.readOnlyTitle', 'Source is read-only')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'settings.mcp.readOnlyDescription',
                    'This definition comes from {{source}}; only the allowed global enable/disable override can be created.',
                    { source: getMcpServerSourceLabel(t, server.source) }
                  )}
                </AlertDescription>
              </Alert>
            )}
            <Separator />
            {server.secretBindings.length > 0 ? (
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {t('settings.mcp.secretsTitle', 'Secret bindings')}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'settings.mcp.secretsDescription',
                      'Bound environment variables, HTTP headers, or OAuth client secrets.'
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {server.secretBindings.map((binding) => (
                    <Badge key={`${binding.kind}:${binding.name}`} variant="secondary">
                      {binding.kind}: {binding.name}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}
          </section>
          <Separator />
          {server.capabilities.remove ? (
            <section className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold">
                  {t('settings.mcp.removeTitle', 'Remove configuration')}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'settings.mcp.removeDescription',
                    'After removing the global definition or override, a lower-level configuration with the same name may reappear.'
                  )}
                </p>
              </div>
              <Button variant="destructive" className="w-full" onClick={() => setRemoveOpen(true)}>
                <Trash2Icon data-icon="inline-start" />
                {t('settings.mcp.removeHostButton', 'Remove Host configuration')}
              </Button>
            </section>
          ) : null}
          <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t('settings.mcp.removeDialogTitle', 'Remove {{name}}?', { name: server.name })}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    'settings.mcp.removeDialogDescription',
                    'This only removes the Host-level global definition or override.'
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRemoveOpen(false)}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={props.mutationPending}
                  onClick={async () => {
                    await props.onRemove(server.serverKey);
                    setRemoveOpen(false);
                  }}
                >
                  {props.mutationPending ? <Spinner data-icon="inline-start" /> : null}
                  {t('settings.mcp.confirmRemove', 'Confirm removal')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      );
    } else {
      return null;
    }
  }
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-6">
        <header className="flex min-w-0 items-start gap-3 border-b pb-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="Back to MCP server list"
            onClick={props.onBack}
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">
                {props.creating ? t('settings.mcp.addTitle', 'Add MCP server') : server?.name}
              </h2>
              {server && (
                <>
                  <Badge variant="outline" title={t('settings.mcp.sourceTitle', 'Configuration source')}>
                    {getMcpServerSourceLabel(t, server.source)}
                  </Badge>
                  <Badge variant="outline" title={t('settings.mcp.managementTitle', 'Management permission')}>
                    {server.management}
                  </Badge>
                  <Badge
                    variant={server.enabled ? 'secondary' : 'destructive'}
                    className={cn(server.enabled && 'bg-success text-white')}
                  >
                    {server.enabled
                      ? t('settings.mcp.stateEnabled', 'Enabled')
                      : t('settings.mcp.stateDisabled', 'Disabled')}
                  </Badge>
                </>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{server?.description || server?.name}</p>
          </div>
        </header>
        {props.mutationError !== undefined ? (
          <Alert variant="destructive">
            <AlertTitle>{t('settings.mcp.saveFailed', 'Failed to save MCP configuration')}</AlertTitle>
            <AlertDescription>{props.mutationError}</AlertDescription>
          </Alert>
        ) : null}
        {renderContent()}
      </div>
    </ScrollArea>
  );
}
