/**
 * @author Codex
 * @description Loads authoritative Server settings within the shared Settings content frame.
 */
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import { getServerSettings } from '@/api/server-settings';
import { useI18n } from '@/i18n/use-i18n';
import { SettingContainer } from '../Layout/SettingContainer';
import { ServerSettingsEditor } from './ServerSettingsEditor';

/**
 * Loads authoritative configuration; never presents default values as a failed read fallback.
 */
export function ServerSettingsPage() {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['server-settings'],
    queryFn: ({ signal }) => getServerSettings(signal),
    retry: false,
  });
  if (query.data) {
    return <ServerSettingsEditor initial={query.data} latest={query.data} />;
  }
  return (
    <SettingContainer>
      {query.isPending ? (
        <Spinner />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>
            {t('settings.server.loadFailed', 'Unable to load server settings.')}
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('common.retry', 'Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </SettingContainer>
  );
}
