/**
 * @author Codex
 * @description Presents Settings as a route-masked Workbench dialog while preserving its canonical URLs.
 */

import { useNavigate, useRouter } from '@tanstack/react-router';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { DefaultModelPage } from '../default-model/DefaultModelPage';
import { AboutPage } from '../about/AboutPage';
import { PermissionsPage } from '../permissions/PermissionsPage';
import { EnvironmentPage } from '../environment/EnvironmentPage';
import { ExtensionsPage } from '../extensions/ExtensionsPage';
import { ModelProvidersPage } from '../model-providers/ModelProvidersPage';
import { McpServersPage } from '../mcp-servers/McpServersPage';
import { ServerSettingsPage } from '../server/ServerSettingsPage';
import { SettingsPlaceholderPage } from '../Placeholder/SettingsPlaceholderPage';
import { SettingsFrame } from './SettingsFrame';
import { SchedulerSettingsPage } from '../schedules/SchedulerSettingsPage';
import { KnowledgeSettingsPage } from '../knowledge/KnowledgeSettingsPage';
import { LanguageSettingsPage } from '../language/LanguageSettingsPage';
import { MemorySettingsPage } from '../memory/MemorySettingsPage';
import { JevSettingsPage } from '../JevSettingsPage';
import { ShortcutsSettingsPage } from '../shortcuts/ShortcutsSettingsPage';
import { SnippetsSettingsPage } from '../snippets/SnippetsSettingsPage';
import { useI18n } from '@/i18n/use-i18n';
import type { ReactNode } from 'react';
import type { SettingsModalLocation, SettingsPath } from '@/router/settings-modal';

export interface SettingsDialogHostProps {
  location: SettingsModalLocation;
}

/**
 * Owns modal Settings history so internal navigation replaces one dialog entry.
 */
export function SettingsDialogHost({ location }: SettingsDialogHostProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const router = useRouter();

  /**
   * Replaces the current masked entry without losing the underlying Workbench location.
   */
  const replaceSettingsLocation = (next: SettingsModalLocation): void => {
    if (next.path === '/settings/model-providers') {
      void navigate({
        to: '.',
        search: (previous) => ({ ...previous, settings: next }),
        replace: true,
        mask: {
          to: '/settings/model-providers',
          search: next.provider === undefined ? {} : { provider: next.provider },
          unmaskOnReload: true,
        },
      });
      return;
    }
    void navigate({
      to: '.',
      search: (previous) => ({ ...previous, settings: next }),
      replace: true,
      mask: { to: next.path, unmaskOnReload: true },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          router.history.back();
        }
      }}
    >
      <DialogContent className="h-dvh w-screen max-w-none gap-0 overflow-hidden rounded-none p-0 sm:h-[min(80vh,56rem)] sm:w-[min(94vw,60rem)] sm:max-w-none sm:rounded-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('settings.frame.titleFallback', 'Settings')}</DialogTitle>
          <DialogDescription>
            {t('settings.frame.dialogDescription', 'Configure global agent behavior and Pi resources.')}
          </DialogDescription>
        </DialogHeader>
        <SettingsFrame pathname={location.path} onNavigate={(path) => replaceSettingsLocation({ path })}>
          <SettingsDialogPage
            location={location}
            onProviderChange={(provider) =>
              replaceSettingsLocation({ path: '/settings/model-providers', provider })
            }
          />
        </SettingsFrame>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Selects the Settings page owned by the current validated modal location.
 */
function SettingsDialogPage({
  location,
  onProviderChange,
}: {
  location: SettingsModalLocation;
  onProviderChange(provider?: string): void;
}): ReactNode {
  switch (location.path) {
    case '/settings/about':
      return <AboutPage />;
    case '/settings/server':
      return <ServerSettingsPage />;
    case '/settings/model-providers':
      return <ModelProvidersPage provider={location.provider} onProviderChange={onProviderChange} />;
    case '/settings/default-model':
      return <DefaultModelPage />;
    case '/settings/permissions':
      return <PermissionsPage />;
    case '/settings/environment':
      return <EnvironmentPage />;
    case '/settings/mcp':
      return <McpServersPage />;
    case '/settings/extensions':
      return <ExtensionsPage />;
    case '/settings/schedules':
      return <SchedulerSettingsPage />;
    case '/settings/knowledge':
      return <KnowledgeSettingsPage />;
    case '/settings/jev':
      return <JevSettingsPage />;
    case '/settings/memory':
      return <MemorySettingsPage />;
    case '/settings/appearance/language':
      return <LanguageSettingsPage />;
    case '/settings/appearance/shortcuts':
      return <ShortcutsSettingsPage />;
    case '/settings/appearance/snippets':
      return <SnippetsSettingsPage />;
    default:
      return <SettingsPlaceholderPage pathname={location.path satisfies SettingsPath} />;
  }
}
