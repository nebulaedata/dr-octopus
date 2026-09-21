/**
 * @author Codex
 * @description Confirms interruption and resolves a single accepted Server restart without replaying mutations.
 */
import { useRef } from 'react';
import { useCountDown, useSafeState } from 'ahooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Spinner } from '@octopus/ui/components/spinner';
import { getServerRestartOperation, restartServer } from '@/api/server-settings';
import { useI18n } from '@/i18n/use-i18n';
import { ApiRequestError } from '@/utils/request';
import { ServerServiceCard } from './ServerServiceCard';
import { RestartAccessHint } from './RestartAccessHint';
import type { ServerSettingsDto, RestartOperationDto } from '@octopus/shared/protocol';

const terminal = ['succeeded', 'restored', 'failed', 'cancelled'];
/**
 * Keeps the accepted operation identity local and stops automatic polling after sixty seconds.
 */
export function ServerRestart({
  snapshot,
  disabled,
  onBusy,
}: {
  snapshot: ServerSettingsDto;
  disabled: boolean;
  /**
   * Prevents concurrent edits while an accepted restart is unresolved.
   */
  onBusy(busy: boolean): void;
}) {
  const { t } = useI18n();
  const labels: Record<RestartOperationDto['state'], string> = {
    accepted: t('settings.server.restart.state.accepted', 'Restart accepted'),
    draining: t('settings.server.restart.state.draining', 'Shutting down the old service…'),
    starting: t('settings.server.restart.state.starting', 'Starting the service…'),
    restoring: t('settings.server.restart.state.restoring', 'Restoring the previous configuration…'),
    succeeded: t('settings.server.restart.state.succeeded', 'Service restarted'),
    restored: t(
      'settings.server.restart.state.restored',
      'Apply failed; restored the previous runtime configuration. The newly saved configuration is still pending.'
    ),
    failed: t('settings.server.restart.state.failed', 'Restart failed; recover via the host stop/start.'),
    cancelled: t('settings.server.restart.state.cancelled', 'Restart was cancelled by a stop operation.'),
  };
  const client = useQueryClient();
  const [confirm, setConfirm] = useSafeState(false);
  const [pending, setPending] = useSafeState(false);
  const [error, setError] = useSafeState('');
  const [accepted, setAccepted] = useSafeState<RestartOperationDto>();
  const [startedAt, setStartedAt] = useSafeState(0);
  const [remaining] = useCountDown({ targetDate: startedAt ? startedAt + 60_000 : undefined });
  const expired = startedAt > 0 && remaining === 0;
  const submitting = useRef(false);
  const result = useQuery({
    queryKey: ['server-restart-operation', accepted?.operationId, startedAt],
    enabled: !!accepted,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      try {
        const response = await getServerRestartOperation(accepted!.operationId, signal);
        if (terminal.includes(response.operation.state)) {
          onBusy(false);
          await client.invalidateQueries({ queryKey: ['server-settings'] });
          await client.invalidateQueries({ queryKey: ['environment-settings'] });
        }
        return response.operation;
      } catch (cause) {
        if (cause instanceof ApiRequestError && cause.statusCode === 404) {
          onBusy(false);
        }
        throw cause;
      }
    },
    refetchInterval: (query) => {
      if (
        terminal.includes(query.state.data?.state ?? '') ||
        (query.state.error instanceof ApiRequestError && query.state.error.statusCode === 404)
      ) {
        return false;
      }
      const elapsed = Date.now() - startedAt;
      return elapsed >= 60_000
        ? false
        : elapsed < 1000
          ? 1000
          : elapsed < 3000
            ? 2000
            : elapsed < 7000
              ? 4000
              : 5000;
    },
  });
  const operation = result.data ?? accepted;
  /**
   * Sends once per deliberate confirmation; ambiguous responses remain unknown.
   */
  async function restart(): Promise<void> {
    if (submitting.current) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError('');
    onBusy(true);
    try {
      const response = await restartServer(
        { revision: snapshot.revision, expectedServiceInstanceId: snapshot.serviceInstanceId },
        crypto.randomUUID()
      );
      setStartedAt(Date.now());
      setAccepted(response.operation);
      setConfirm(false);
    } catch (cause) {
      setConfirm(false);
      setError(
        cause instanceof ApiRequestError && cause.statusCode
          ? cause.message
          : t(
              'settings.server.restart.resultUnknown',
              'Restart submission result unknown. Check the current service status and do not resubmit.'
            )
      );
      onBusy(false);
    } finally {
      setPending(false);
      submitting.current = false;
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <ServerServiceCard
        snapshot={snapshot}
        busy={pending || (!!operation && !terminal.includes(operation.state))}
        disabled={disabled}
        onRestart={() => setConfirm(true)}
      />
      {snapshot.capabilities.reason ? (
        <p className="text-xs text-muted-foreground">{snapshot.capabilities.reason}</p>
      ) : null}
      {operation ? (
        <Alert>
          <AlertDescription>
            <span>{labels[operation.state]}</span>
            <RestartAccessHint operation={operation} />
            {operation.state === 'restored' ? (
              <span>
                {t('settings.server.restart.actualAddress', 'Actual listen address: {{address}}', {
                  address: operation.actualAddress,
                })}
              </span>
            ) : null}
            {result.isError || (!terminal.includes(operation.state) && expired) ? (
              <>
                <span>
                  {t(
                    'settings.server.restart.pollHint',
                    'The service is temporarily unreachable or the operation result is unknown; automatic polling lasts at most 60 seconds, and stopping polling does not cancel the restart.'
                  )}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setStartedAt(Date.now())}>
                  {t('settings.server.restart.repoll', 'Poll the result again')}
                </Button>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!pending) {
            setConfirm(open);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.server.restart.confirmTitle', 'Restart the service?')}</DialogTitle>
            <DialogDescription>
              {t(
                'settings.server.restart.confirmDescription',
                'There are {{count}} resident session instances. Restarting disconnects them and interrupts running sessions; chat history is preserved but tasks do not resume automatically. Next listen: {{host}}:{{port}}.',
                {
                  count: snapshot.runtime.activeRuntimeCount,
                  host: String(snapshot.fields.SERVER_HOST.next.value),
                  port: String(snapshot.fields.SERVER_PORT.next.value),
                }
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button disabled={pending} onClick={() => void restart()}>
              {pending ? <Spinner /> : null}
              {t('settings.server.restart.confirmButton', 'Confirm restart')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
