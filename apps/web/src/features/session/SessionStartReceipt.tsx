/**
 * @author Codex
 * @description Presents durable first-message stages through the existing Session alert style.
 */
import { Link } from '@tanstack/react-router';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { useI18n } from '@/i18n/use-i18n';
import { SessionConnectingAlert } from './SessionConnectingAlert';
import type { useSessionStart } from '@/features/session/hooks/use-session-start';

/**
 * Offers cancellation only before acceptance and recovery only for definitively unsent messages.
 */
export function SessionStartReceipt({ startup }: { startup: ReturnType<typeof useSessionStart> }) {
  const { t } = useI18n();
  const { receipt, cancel, recover, recovery, workspaceId } = startup;
  const status = receipt.data?.status;
  const failed = status === 'failed' || status === 'cancelled';
  const error = cancel.error?.message ?? receipt.error?.message;
  if (error || failed || status === 'unknown') {
    /**
     * Selects renderspan content in the existing condition order.
     */
    function renderValue() {
      if (status === 'cancelled') {
        return t('session.startCancelled', 'Preparation cancelled. Your message is saved.');
      } else if (status === 'failed') {
        return t('session.startFailed', 'Could not prepare the conversation. Your message is saved.');
      } else {
        return t(
          'session.startUnknown',
          'Delivery could not be confirmed. Check the conversation before sending again.'
        );
      }
    }
    return (
      <Alert
        variant={status === 'cancelled' && !error ? 'default' : 'destructive'}
        className="pointer-events-auto shadow-lg shadow-black/5 dark:shadow-white/5"
      >
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{recovery.error?.message ?? error ?? receipt.data?.error ?? renderValue()}</span>
          {error ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                cancel.reset();
                void receipt.refetch();
              }}
            >
              {t('common.retry', 'Retry')}
            </Button>
          ) : (
            failed && (
              <Button variant="outline" size="sm" disabled={recovery.isPending} onClick={recover}>
                {t('session.startRestore', 'Return to draft')}
              </Button>
            )
          )}
          {recovery.error && (
            <Link to="/workspaces/$workspaceId" params={{ workspaceId }} className="text-sm underline">
              {t('session.startOpenDraft', 'Open current draft')}
            </Link>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  let label: string | undefined;
  if (status === 'preparing') {
    label = t('session.startPreparing', 'Preparing your conversation…');
  } else if (status === 'accepted') {
    label = t('session.startAccepted', 'Your message is saved. Preparing delivery…');
  } else if (status === 'dispatching') {
    label = t('session.startDispatching', 'Sending your first message…');
  } else {
    label = undefined;
  }
  return (
    <SessionConnectingAlert
      visible={Boolean(label)}
      label={label}
      action={
        status === 'preparing' && (
          <Button variant="ghost" size="xs" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('common.cancel', 'Cancel')}
          </Button>
        )
      }
    />
  );
}
