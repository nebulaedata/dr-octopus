/**
 * @author Codex
 * @description Displays a delayed realtime connection-loss banner without flashing during startup.
 */

import { useRealtimeConnection } from '@/hooks/use-realtime';
import { useDebounceEffect } from 'ahooks';
import { WifiOffIcon } from 'lucide-react';
import { useState } from 'react';
import { ConnectionFailedStatus } from './ConnectionFailedStatus';
import { ReconnectingStatus } from './ReconnectingStatus';
import { useI18n } from '@/i18n/use-i18n';

const CONNECTION_LOST_DELAY_MS = 500;

/**
 * Delays transient connection-loss feedback while hiding it immediately after recovery.
 */
export function ConnectionStatus() {
  const { t } = useI18n();
  const connection = useRealtimeConnection();
  const offline = connection === 'offline';
  const [visible, setVisible] = useState(false);

  useDebounceEffect(
    () => {
      setVisible(offline);
    },
    [offline],
    { wait: CONNECTION_LOST_DELAY_MS }
  );

  if (connection === 'reconnecting') {
    return <ReconnectingStatus />;
  }

  if (connection === 'failed') {
    return <ConnectionFailedStatus />;
  }

  if (!offline || !visible) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 z-50 w-full h-5 bg-amber-400 dark:bg-amber-600 text-white flex items-center justify-center gap-1">
      <WifiOffIcon className="size-3" />
      <span>
        <span className="text-xs font-medium">{t('layout.connection.lostTitle', 'Realtime connection lost')}</span>
        <span className="text-xs"> - </span>
        <span className="text-xs font-medium">{t('layout.connection.lostHint', 'Waiting to reconnect')}</span>
      </span>
    </div>
  );
}
