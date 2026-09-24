/**
 * @author Codex
 * @description Presents honest, navigation-safe placeholders for deferred Settings modules.
 */

import { SettingContainer } from '../Layout/SettingContainer';
import { ConstructionIcon } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { useI18n } from '@/i18n/use-i18n';
import { useSettingsNavigation } from '@/features/settings/hooks/use-settings-navigation';
import type { SettingsPath } from '@/features/settings/hooks/use-settings-navigation';

export interface SettingsPlaceholderPageProps {
  pathname: SettingsPath;
}

/**
 * Renders the current deferred Settings route without fake form controls.
 */
export function SettingsPlaceholderPage({ pathname }: SettingsPlaceholderPageProps) {
  const { t } = useI18n();
  const { item } = useSettingsNavigation(pathname);
  return (
    <SettingContainer>
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ConstructionIcon />
          </EmptyMedia>
          <EmptyTitle>
            {t('settings.placeholder.title', '{{module}} is not available yet', {
              module: item?.label ?? t('settings.placeholder.defaultModule', 'Settings module'),
            })}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              'settings.placeholder.description',
              'This entry is part of the Settings information architecture; real configuration arrives once the backend contract is finalized.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SettingContainer>
  );
}
