/**
 * @author Codex
 * @description Displays authoritative configuration staleness and restart outcomes using the shared Session action.
 */
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { RestartSessionDialog } from './RestartSessionDialog';
import { useRestartSession } from './use-restart-session';
import { useI18n } from '@/i18n/use-i18n';
import { AlertTriangleIcon } from 'lucide-react';
import { Spinner } from '@octopus/ui/components/spinner';
import type { SessionDto } from '@octopus/shared/protocol';

/**
 * Offers manual configuration adoption while preserving the current conversation and draft.
 */
export function SessionConfigAlert({ session }: { session: SessionDto }) {
  const { t } = useI18n();
  const action = useRestartSession();
  const control = session.runtimeControl;
  const restarting = action.pending.includes(session.id) || control?.restart.status === 'restarting';
  if (
    !control?.restartRequired &&
    !restarting &&
    control?.restart.status !== 'failed' &&
    !action.error &&
    !action.confirmation
  ) {
    return null;
  }
  return (
    <>
      <Alert
        variant={control?.restart.status === 'failed' ? 'destructive' : 'default'}
        className="pointer-events-auto shadow-lg shadow-black/5 dark:shadow-white/5 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50"
      >
        {restarting ? <Spinner /> : <AlertTriangleIcon />}
        <AlertTitle>
          {restarting
            ? t('session.configAlert.titleRestarting', 'Restarting session')
            : control?.restart.status === 'failed'
              ? t('session.configAlert.titleFailed', 'Session restart failed')
              : t('session.configAlert.titleChanged', 'Model service configuration changed')}
        </AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>
            {restarting
              ? t(
                  'session.configAlert.descriptionRestarting',
                  'Reloading the configuration; one moment please.'
                )
              : (control?.restart.error?.message ??
                t(
                  'session.configAlert.descriptionDefault',
                  'Takes effect after restarting the session; chat history is kept.'
                ))}
          </span>
          <AlertAction>
            {session.runtime?.state === 'running' && (
              <Button
                size="sm"
                variant="outline"
                disabled={restarting || control?.restartOnIdle}
                onClick={() => action.start(session, true)}
              >
                {control?.restartOnIdle
                  ? t('session.configAlert.queued', 'Update queued until the task finishes')
                  : t('session.configAlert.whenIdle', 'Apply after task finishes')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="mt-1.5"
              disabled={restarting || control?.restart.error?.retryable === false}
              onClick={() => action.start(session)}
            >
              {restarting && <Spinner />}
              {t('session.configAlert.restartButton', 'Restart session')}
            </Button>
          </AlertAction>
        </AlertDescription>
      </Alert>
      <RestartSessionDialog action={action} />
    </>
  );
}
