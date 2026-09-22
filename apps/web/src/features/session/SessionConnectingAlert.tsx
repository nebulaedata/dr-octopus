/**
 * @author longlongago2
 * @description Announces transient Agent bootstrap progress as a floating status card alongside the other Session alerts.
 */

import { Alert } from '@octopus/ui/components/alert';
import { Marker, MarkerContent, MarkerIcon } from '@octopus/ui/components/marker';
import { Spinner } from '@octopus/ui/components/spinner';
import { useI18n } from '@/i18n/use-i18n';
import type { ReactNode } from 'react';

/**
 * Presents the in-progress Agent connection politely while history and the draft stay usable.
 *
 * @param props - Visibility gate derived by the page from readiness, runtime error, and restart state.
 * @returns A neutral floating status card, or nothing outside the connection window.
 */
export function SessionConnectingAlert({
  visible,
  label,
  action,
}: {
  visible: boolean;
  label?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  if (!visible) {
    return null;
  }
  return (
    // role="status" relies on the Alert primitive spreading props after its default role="alert".
    <Alert
      role="status"
      className="pointer-events-auto flex items-center gap-3 shadow-lg shadow-black/5 dark:shadow-white/5 w-fit max-w-full"
    >
      <Marker>
        <MarkerIcon>
          <Spinner className="size-3.5" />
        </MarkerIcon>
        <MarkerContent className="shimmer text-xs font-geist">
          {label ?? t('session.connectingAlert.label', 'Connecting to Agent…')}
        </MarkerContent>
      </Marker>
      {action}
    </Alert>
  );
}
