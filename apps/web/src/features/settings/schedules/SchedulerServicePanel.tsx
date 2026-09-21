/**
 * @author Codex
 * @description Presents Scheduler lifecycle controls and live execution diagnostics in Settings.
 */
import { StatCard } from '@/components/StatCard';
import { formatDateTime } from '@/utils/date';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIcon, ClockIcon, ListTodoIcon, RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Spinner } from '@octopus/ui/components/spinner';
import { Switch } from '@octopus/ui/components/switch';
import { toast } from '@octopus/ui/components/toast';
import { controlSchedulerService, getSchedulerServiceStatus } from '@/api/scheduled-tasks';
import { useI18n } from '@/i18n/use-i18n';
import type { SchedulerServiceAction, SchedulerServiceStatus } from '@/api/scheduled-tasks';

/**
 * Formats an optional daemon timestamp in the browser locale.
 */
function formatTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : '—';
}

/**
 * Narrows the lifecycle union to the diagnostic-bearing online state.
 */
function isControlReady(
  value: SchedulerServiceStatus | undefined
): value is Extract<SchedulerServiceStatus, { state: 'control-ready' }> {
  return value?.state === 'control-ready';
}

/**
 * Controls the process-independent singleton without coupling the page to daemon transport details.
 */
export function SchedulerServicePanel() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['scheduler-service'],
    queryFn: ({ signal }) => getSchedulerServiceStatus(signal),
  });
  const control = useMutation({
    mutationFn: (action: SchedulerServiceAction) => controlSchedulerService(action),
    onSuccess: async (result, action) => {
      queryClient.setQueryData(['scheduler-service'], result);
      await queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['scheduler-settings'] });
      toast.add({
        title:
          action === 'stop'
            ? t('settings.scheduler.service.stopped', 'Scheduler service stopped')
            : t('settings.scheduler.service.started', 'Scheduler service started'),
        description:
          action === 'stop'
            ? t(
                'settings.scheduler.service.stoppedDescription',
                'Task data is preserved; running tasks will be interrupted.'
              )
            : t('settings.scheduler.service.startedDescription', 'The service runs independently in the background.'),
        type: 'success',
      });
    },
  });
  const current = status.data;
  /**
   * Maps the transport state to a compact user-facing label and semantic badge.
   */
  const presentation = ((): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'warning' } => {
    if (current?.state === 'control-ready') {
      return current.executionReady && !current.degraded
        ? { label: t('settings.scheduler.service.stateRunning', 'Running'), variant: 'default' }
        : { label: t('settings.scheduler.service.stateDegraded', 'Degraded'), variant: 'warning' };
    }
    if (current?.state === 'stopped') {
      return { label: t('settings.scheduler.service.stateStopped', 'Stopped'), variant: 'secondary' };
    }
    if (current?.state === 'unavailable') {
      return { label: t('settings.scheduler.service.stateUnreachable', 'Unreachable'), variant: 'destructive' };
    }
    return { label: t('settings.scheduler.service.stateAbsent', 'Not started'), variant: 'secondary' };
  })();
  const running = isControlReady(current);
  const diagnostics = isControlReady(current) ? current : undefined;

  return (
    <Card>
      <CardHeader className="relative gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">{t('settings.scheduler.service.title', 'Scheduler service')}</CardTitle>
            <Badge variant={presentation.variant}>{presentation.label}</Badge>
          </div>
          <CardDescription className="text-xs">
            {t(
              'settings.scheduler.service.description',
              'The global singleton service runs independently of session runtimes. Once explicitly stopped, the agent will not restart it automatically.'
            )}
          </CardDescription>
        </div>
        <div className="absolute right-5 top-2 flex items-center gap-3">
          {control.isPending ? <Spinner /> : null}
          <Switch
            checked={running}
            disabled={status.isPending || control.isPending}
            aria-label={running ? 'Stop scheduler service' : 'Start scheduler service'}
            onCheckedChange={(checked) => control.mutate(checked ? 'start' : 'stop')}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(status.error ?? control.error) instanceof Error ? (
          <Alert variant="destructive">
            <AlertTitle>{t('settings.scheduler.service.operationFailed', 'Service operation failed')}</AlertTitle>
            <AlertDescription>{(control.error ?? status.error)?.message}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={ActivityIcon}
            title={t('settings.scheduler.service.executionStatus', 'Execution status')}
            value={
              diagnostics?.executionReady
                ? t('settings.scheduler.service.ready', 'Ready')
                : t('settings.scheduler.service.notReady', 'Not ready')
            }
          />
          <StatCard
            icon={ListTodoIcon}
            title={t('settings.scheduler.service.runningQueued', 'Running / Queued')}
            value={diagnostics ? `${diagnostics.running} / ${diagnostics.queued}` : '—'}
            classNames={{ value: 'font-geist text-xs font-normal' }}
          />
          <StatCard
            icon={ClockIcon}
            title={t('settings.scheduler.service.nextRun', 'Next run')}
            value={formatTime(diagnostics?.nextRunAt)}
            classNames={{ value: 'font-geist text-xs font-normal' }}
          />
          <StatCard
            icon={RefreshCwIcon}
            title={t('settings.scheduler.service.lastScan', 'Last scan')}
            value={formatTime(diagnostics?.lastScanAt)}
            classNames={{ value: 'font-geist text-xs font-normal' }}
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={(!running && !status.isError) || control.isPending}
            onClick={() => control.mutate('restart')}
          >
            <RefreshCwIcon />
            {t('settings.scheduler.service.restart', 'Restart service')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
