/**
 * @author Codex
 * @description Displays the elapsed time for the active realtime reconnection attempt.
 */

import { RefreshCwIcon } from 'lucide-react';
import { ElapsedOdometer } from '@octopus/custom-ui/components/elapsed-time';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Counts from zero while a realtime reconnection attempt remains active.
 *
 * Uses the shared ElapsedOdometer in client-authoritative mode: the value anchors on
 * the browser monotonic clock at mount and interpolates forward, so background
 * tab throttling can no longer undercount the way `+= 1` accumulation did.
 */
export function ReconnectingStatus() {
  const { t } = useI18n();
  return (
    <div className="fixed top-0 left-0 z-50 flex h-5 w-full items-center justify-center gap-1 bg-blue-500 text-white dark:bg-blue-700">
      <RefreshCwIcon className="size-3 animate-spin" />
      <span className="text-xs font-medium">{t('layout.connection.reconnecting', 'Realtime reconnecting')}</span>
      <span className="text-xs">
        - <ElapsedOdometer elapsedMs={0} running />
      </span>
    </div>
  );
}
