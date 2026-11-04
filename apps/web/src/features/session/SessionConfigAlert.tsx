/**
 * @author Codex
 * @description Displays authoritative configuration staleness and restart outcomes using the shared Session action.
 */
import { Alert } from '@octopus/custom-ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { RestartSessionDialog } from './RestartSessionDialog';
import { useRestartSession } from '@/features/session/hooks/use-restart-session';
import { useI18n } from '@/i18n/use-i18n';

import { Spinner } from '@octopus/ui/components/spinner';
import type { SessionDto } from '@octopus/shared/protocol';
import type { AlertVariant } from '@octopus/custom-ui/components/alert';

/**
 * Offers manual configuration adoption while preserving the current conversation and draft.
 */
export function SessionConfigAlert({ session }: { session: SessionDto }) {
  const { t } = useI18n();
  const action = useRestartSession();
  const control = session.runtimeControl;
  const restarting = action.pending.includes(session.id) || control?.restart.status === 'restarting';
  let alertVariant: AlertVariant = 'warning';
  if (restarting) {
    alertVariant = 'info';
  } else if (control?.restart.status === 'failed') {
    alertVariant = 'danger';
  }
  if (
    !control?.restartRequired &&
    !restarting &&
    control?.restart.status !== 'failed' &&
    !action.error &&
    !action.confirmation
  ) {
    return null;
  }
  /**
   * Selects alert title content in the existing condition order.
   */
  function renderAlertTitleContent() {
    if (restarting) {
      return t('session.configAlert.titleRestarting', 'Restarting session');
    } else if (control?.restart.status === 'failed') {
      return t('session.configAlert.titleFailed', 'Session restart failed');
    } else {
      return t('session.configAlert.titleChanged', 'Agent configuration changed');
    }
  }
  return (
    <>
      <Alert
        className="pointer-events-auto shadow-lg shadow-black/5 dark:shadow-white/5"
        variant={alertVariant}
        showIcon
        icon={restarting ? <Spinner /> : undefined}
        title={renderAlertTitleContent()}
        description={
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
        }
        action={
          <>
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
          </>
        }
      />
      <RestartSessionDialog action={action} />
    </>
  );
}
