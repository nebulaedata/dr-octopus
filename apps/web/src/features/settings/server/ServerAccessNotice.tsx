/**
 * @author Codex
 * @description Explains access changes without redirecting remote browsers to their own loopback address.
 */
import { useMount, useSafeState } from 'ahooks';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { useI18n } from '@/i18n/use-i18n';
import type { ServerSettingsDto } from '@octopus/shared/protocol';

/**
 * Warns about losing the current extra Origin and about disabling remote listening.
 */
export function ServerAccessNotice({
  snapshot,
  host,
  cors,
}: {
  snapshot: ServerSettingsDto;
  host: string | null;
  cors: string | null;
}) {
  const { t } = useI18n();
  const [origin, setOrigin] = useSafeState('');
  useMount(() => setOrigin(window.location.origin));
  const nextHost = snapshot.fields.SERVER_HOST.overridden
    ? String(snapshot.fields.SERVER_HOST.next.value)
    : (host ?? '127.0.0.1');
  const nextCors = snapshot.fields.SERVER_CORS_ORIGIN.overridden
    ? String(snapshot.fields.SERVER_CORS_ORIGIN.next.value)
    : (cors ?? '');
  const closesRemote = snapshot.fields.SERVER_HOST.current.value !== '127.0.0.1' && nextHost === '127.0.0.1';
  const removesOrigin =
    !!origin &&
    String(snapshot.fields.SERVER_CORS_ORIGIN.current.value).split(',').includes(origin) &&
    !nextCors.split(',').includes(origin);
  if (!closesRemote && !removesOrigin) {
    return null;
  }
  return (
    <Alert>
      <AlertDescription>
        {closesRemote ? (
          <span>
            {t(
              'settings.server.access.remoteClosesHint',
              'After a restart, remote pages will disconnect. Use a local address on the service host to access it.'
            )}
          </span>
        ) : null}
        {removesOrigin ? (
          <span>
            {t(
              'settings.server.access.originRemovedHint',
              'After a restart, the current extra origin will no longer have access; use a same-origin entry on the service or adjust the launch configuration.'
            )}
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
