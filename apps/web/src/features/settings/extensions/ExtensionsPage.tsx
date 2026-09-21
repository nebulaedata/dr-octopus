/**
 * @author Codex
 * @description Reserves the implemented-scope Extension page without exposing unsupported mutations.
 */

import { SettingContainer } from '../layout/SettingContainer';
import { BoxesIcon } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Presents the Extension vertical-slice boundary until its Pi resource API is connected.
 */
export function ExtensionsPage() {
  const { t } = useI18n();
  return (
    <SettingContainer>
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BoxesIcon />
          </EmptyMedia>
          <EmptyTitle>{t('settings.extensions.title', 'Extension resources are being wired up')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'settings.extensions.description',
              'The page shell is ready; Extension entrypoint queries and enable/disable actions will be connected in the next vertical slice.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SettingContainer>
  );
}
