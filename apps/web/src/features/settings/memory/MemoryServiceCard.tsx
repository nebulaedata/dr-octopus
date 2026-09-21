/**
 * @author Codex
 * @description Shared memory daemon lifecycle controls matching the knowledge service settings.
 */
import { BrainIcon, PlayIcon, SquareIcon, RotateCwIcon } from 'lucide-react';
import { Card, CardContent } from '@octopus/ui/components/card';
import { Button } from '@octopus/ui/components/button';
import { Badge } from '@octopus/ui/components/badge';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import type { MemoryServiceStatus } from '@octopus/shared/protocol/memory';

/**
 * Present explicit lifecycle actions without confusing stopped service with disabled memory policy.
 */
export function MemoryServiceCard({
  status,
  loading,
  failed,
  pending,
  onAction,
}: {
  status?: MemoryServiceStatus;
  loading: boolean;
  failed: boolean;
  pending?: 'start' | 'stop' | 'restart';
  onAction: (action: 'start' | 'stop' | 'restart') => void;
}) {
  const { t } = useI18n();
  const labels = {
    absent: t('memory.service.state.absent', 'Not started'),
    stopped: t('memory.service.state.stopped', 'Stopped'),
    starting: t('memory.service.state.starting', 'Starting'),
    running: t('memory.service.state.running', 'Running'),
    stopping: t('memory.service.state.stopping', 'Stopping'),
    unavailable: t('memory.service.state.unavailable', 'Unavailable'),
  };
  const pendingLabels = pending
    ? {
        start: labels.starting,
        stop: labels.stopping,
        restart: t('memory.service.restarting', 'Restarting'),
      }[pending]
    : undefined;
  const active = status?.state === 'running';
  const busy = !!pending || loading || status?.state === 'stopping' || status?.state === 'starting';
  return (
    <Card className="shrink-0 shadow-none">
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="rounded-xl bg-primary/8 p-3">
          <BrainIcon className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {t('memory.service.title', 'Memory service')}
            <Badge
              variant="secondary"
              className={cn(active ? 'bg-success/12 text-success' : 'text-muted-foreground')}
              aria-live="polite"
            >
              {pendingLabels ??
                (loading
                  ? t('memory.service.checking', 'Checking')
                  : failed
                    ? t('memory.service.unknown', 'Status unknown')
                    : status
                      ? labels[status.state]
                      : t('memory.service.unknown', 'Status unknown'))}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              'memory.service.description',
              'One background service is shared across all workspaces. Once stopped, start it manually; existing memories are kept.'
            )}
          </p>
        </div>
        <div className="flex w-full justify-end gap-2 sm:w-auto">
          <Button
            size="sm"
            variant={active ? 'destructive' : 'default'}
            disabled={busy || failed}
            aria-busy={!!pending && pending !== 'restart'}
            onClick={() => onAction(active ? 'stop' : 'start')}
          >
            {pending && pending !== 'restart' ? (
              <Spinner data-icon="inline-start" />
            ) : active ? (
              <SquareIcon data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {pending === 'start'
              ? t('memory.service.startingProgress', 'Starting…')
              : pending === 'stop'
                ? t('memory.service.stoppingProgress', 'Stopping…')
                : active
                  ? t('memory.service.stop', 'Stop')
                  : t('memory.service.start', 'Start')}
          </Button>
          {active || status?.state === 'unavailable' || pending === 'restart' ? (
            <Button
              size="sm"
              disabled={busy || failed}
              aria-label="Restart memory service"
              aria-busy={pending === 'restart'}
              onClick={() => onAction('restart')}
            >
              {pending === 'restart' ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCwIcon data-icon="inline-start" />
              )}
              {t('memory.service.restart', 'Restart')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
