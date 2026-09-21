/**
 * @author Codex
 * @description Presents Server runtime status using the Memory settings service-card layout.
 */
import { ServerIcon, RotateCwIcon } from 'lucide-react';
import { Card, CardContent } from '@octopus/ui/components/card';
import { Button } from '@octopus/ui/components/button';
import { Badge } from '@octopus/ui/components/badge';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import type { ServerSettingsDto } from '@octopus/shared/protocol';

/**
 * Mirrors Memory's icon, status, description and right-aligned compact action row.
 */
export function ServerServiceCard({
  snapshot,
  busy,
  disabled,
  onRestart,
}: {
  snapshot: ServerSettingsDto;
  busy: boolean;
  disabled: boolean;
  /**
   * Opens the explicit interruption confirmation without saving draft fields.
   */
  onRestart(): void;
}) {
  const { t } = useI18n();
  const active = snapshot.runtime.state === 'running' && !busy;
  const labels = {
    running: t('settings.server.service.state.running', 'Running'),
    restarting: t('settings.server.service.state.restarting', 'Restarting'),
    stopping: t('settings.server.service.state.stopping', 'Stopping'),
    failed: t('settings.server.service.state.failed', 'Unavailable'),
  };
  return (
    <Card className="shrink-0 shadow-none">
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="rounded-xl bg-primary/8 p-3">
          <ServerIcon className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {t('settings.server.service.title', 'Service runtime')}
            <Badge
              variant="secondary"
              className={cn(active ? 'bg-success/12 text-success' : 'text-muted-foreground')}
              aria-live="polite"
            >
              {busy ? labels.restarting : labels[snapshot.runtime.state]}
            </Badge>
            {snapshot.pendingRestartFields.length || snapshot.additionalPendingRestart ? (
              <Badge variant="outline">{t('settings.server.service.pendingRestart', 'Restart pending')}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              'settings.server.service.description',
              'The agent service process; restarting briefly disconnects the current service, so proceed with care.'
            )}
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {snapshot.runtime.address ??
              `${snapshot.fields.SERVER_HOST.current.value}:${snapshot.fields.SERVER_PORT.current.value}`}{' '}
            ·{' '}
            {t('settings.server.service.residentInstances', '{{count}} resident instance', {
              count: snapshot.runtime.activeRuntimeCount,
              defaultValue_other: '{{count}} resident instances',
            })}
          </p>
        </div>
        <div className="flex w-full justify-end gap-2 sm:w-auto">
          <Button
            type="button"
            size="sm"
            aria-label="Restart service"
            aria-busy={busy}
            disabled={disabled || busy || !snapshot.capabilities.restart}
            onClick={onRestart}
          >
            {busy ? <Spinner data-icon="inline-start" /> : <RotateCwIcon data-icon="inline-start" />}
            {t('settings.server.service.restart', 'Restart')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
