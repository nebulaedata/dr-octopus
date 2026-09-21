/**
 * @author Codex
 * @description Offers explicit direct-access links while preserving proxy and remote-loopback boundaries.
 */
import { useMount, useSafeState } from 'ahooks';
import { useI18n } from '@/i18n/use-i18n';
import type { RestartOperationDto } from '@octopus/shared/protocol';

/**
 * Never probes or redirects across origins; only a user click opens a labeled direct connection.
 */
export function RestartAccessHint({ operation }: { operation: RestartOperationDto }) {
  const { t } = useI18n();
  const [hostname, setHostname] = useSafeState('');
  useMount(() => setHostname(window.location.hostname));
  if (operation.state === 'restored') {
    return null;
  }
  if (operation.access.kind === 'local_only') {
    return (
      <span>
        {t(
          'settings.server.restart.accessLocalOnly',
          'Remote access is off; open {{url}} on the service host. Do not access your own localhost from a remote device.',
          { url: operation.access.loopbackUrl }
        )}
      </span>
    );
  }
  if (operation.access.kind !== 'port_changed') {
    return null;
  }
  const direct =
    hostname && !import.meta.env.DEV ? `http://${hostname}:${operation.access.port}/settings/server` : null;
  return (
    <span>
      {t('settings.server.restart.accessPortChanged', 'Target port: {{port}}.', {
        port: operation.access.port,
      })}
      {direct ? (
        <a className="underline underline-offset-4" href={direct} target="_blank" rel="noreferrer">
          {t('settings.server.restart.openDirectLink', 'Open direct entry')}
        </a>
      ) : null}
      {t(
        'settings.server.restart.accessProxyHint',
        'Reverse proxies should keep using the current public entry. The Vite dev environment needs the root .env SERVER_PORT synced and Vite restarted.'
      )}
    </span>
  );
}
