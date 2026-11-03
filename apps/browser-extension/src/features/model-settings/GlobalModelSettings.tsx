/**
 * @author Codex
 * @description Loads model metadata for the global settings route while retaining the form across popup navigation.
 */
import { useEffect, useState } from 'react';
import { Alert } from '@octopus/custom-ui/components/alert';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { PopupPage } from '../../components/PopupPage';
import { NavigationBar } from '../../components/NavigationBar';
import { ModelSettings } from './ModelSettings';
import type { ModelSettings as Configuration } from '../../lib/model-settings/model-settings-messages';
import { modelSettingsRequest } from '../../lib/model-settings/model-settings-client';

/**
 * Fetches safe metadata only; saved key plaintext is never returned to this component.
 */
export function GlobalModelSettings({ visible, back }: { visible: boolean; back: () => void }) {
  const [settings, setSettings] = useState<Configuration | null>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void modelSettingsRequest<Configuration | null>({ type: 'settings-read' }, controller.signal).then(
      setSettings,
      () => {
        if (!controller.signal.aborted) {
          setError('模型设置暂时无法读取。');
        }
      }
    );
    return () => controller.abort();
  }, []);
  if (settings === undefined) {
    return (
      <PopupPage scrollLabel="模型设置" header={<NavigationBar title="模型设置" onBack={back} />}>
        {error ? <Alert variant="danger" description={error} /> : <Skeleton className="h-32" />}
      </PopupPage>
    );
  }
  return <ModelSettings settings={settings} visible={visible} busy={false} back={back} />;
}
