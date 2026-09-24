/**
 * @author Codex
 * @description Displays the terminal realtime state after bounded reconnect attempts are exhausted.
 */

import { MAX_REALTIME_RECONNECT_ATTEMPTS } from '@/lib/runtime/realtime-client';
import { CircleXIcon } from 'lucide-react';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Explains that automatic reconnecting has stopped and a page refresh starts a new cycle.
 */
export function ConnectionFailedStatus() {
  const { t } = useI18n();
  return (
    <div className="fixed top-0 left-0 z-50 flex h-5 w-full items-center justify-center gap-1 bg-red-500 text-white dark:bg-red-700">
      <CircleXIcon className="size-3" />
      <span className="text-xs font-medium">
        {t('layout.connection.failedTitle', 'Realtime reconnect failed after {{attempts}} attempts', {
          attempts: MAX_REALTIME_RECONNECT_ATTEMPTS,
        })}
      </span>
      <span className="text-xs">- {t('layout.connection.failedHint', 'Refresh to try again')}</span>
    </div>
  );
}
