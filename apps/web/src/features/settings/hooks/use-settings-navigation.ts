/**
 * @author Codex
 * @description Defines the Settings information architecture independently from rendered navigation.
 */

import {
  BookOpenIcon,
  BoxesIcon,
  BracesIcon,
  BrainIcon,
  Building2Icon,
  CalendarClockIcon,
  FileBadgeIcon,
  KeyboardIcon,
  LanguagesIcon,
  LibraryIcon,
  MessageSquareTextIcon,
  NetworkIcon,
  PaletteIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WaypointsIcon,
} from 'lucide-react';
import { useI18n } from '@/i18n/use-i18n';
import type { ComponentType } from 'react';
import type { SettingsPath } from '@/router/settings-modal';
import type { Translate } from '@/i18n/use-i18n';

export type { SettingsPath } from '@/router/settings-modal';

export interface SettingsNavigationItem {
  label: string;
  description: string;
  path: SettingsPath;
  icon: ComponentType;
  pageType: 'complete' | 'placeholder';
}

export interface SettingsNavigationGroup {
  label?: string;
  items: SettingsNavigationItem[];
}

/**
 * Builds the localized Settings navigation tree for the current render.
 */
function getSettingsNavigation(t: Translate): SettingsNavigationGroup[] {
  return [
    {
      label: t('settings.nav.group.basics', 'Basics'),
      items: [
        {
          label: t('settings.nav.modelProviders.label', 'Model providers'),
          description: t(
            'settings.nav.modelProviders.description',
            'Manage model providers, endpoints, and authentication.'
          ),
          path: '/settings/model-providers',
          icon: WaypointsIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.defaultModel.label', 'Default model'),
          description: t(
            'settings.nav.defaultModel.description',
            'Choose the default model for new sessions; running sessions are unaffected.'
          ),
          path: '/settings/default-model',
          icon: SparklesIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.mcp.label', 'MCP Servers'),
          description: t(
            'settings.nav.mcp.description',
            'Add and manage MCP server connections and available tools.'
          ),
          path: '/settings/mcp',
          icon: NetworkIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.knowledge.label', 'Knowledge'),
          description: t(
            'settings.nav.knowledge.description',
            'Manage the knowledge service, model configuration, sharing, and remote mounts.'
          ),
          path: '/settings/knowledge',
          icon: LibraryIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.memory.label', 'Memory'),
          description: t(
            'settings.nav.memory.description',
            'Configure the long-term memory mode shared across workspaces.'
          ),
          path: '/settings/memory',
          icon: BrainIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.jev.label', 'Jev'),
          description: t('settings.nav.jev.description', 'Configure the Jev model and API key.'),
          path: '/settings/jev',
          icon: SparklesIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.schedules.label', 'Scheduled tasks'),
          description: t(
            'settings.nav.schedules.description',
            'Manage the scheduler service, default timezone, and concurrency.'
          ),
          path: '/settings/schedules',
          icon: CalendarClockIcon,
          pageType: 'complete',
        },
      ],
    },
    {
      label: t('settings.nav.group.appearance', 'Appearance'),
      items: [
        {
          label: t('settings.nav.theme.label', 'Theme mode'),
          description: t('settings.nav.theme.description', 'Theme mode configuration is not available yet.'),
          path: '/settings/appearance/theme',
          icon: PaletteIcon,
          pageType: 'placeholder',
        },
        {
          label: t('settings.nav.language.label', 'Language'),
          description: t(
            'settings.nav.language.description',
            'Choose the interface language; changes apply immediately.'
          ),
          path: '/settings/appearance/language',
          icon: LanguagesIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.shortcuts.label', 'Keyboard shortcuts'),
          description: t(
            'settings.nav.shortcuts.description',
            'View and customize keyboard shortcuts for sessions, layout, and composer.'
          ),
          path: '/settings/appearance/shortcuts',
          icon: KeyboardIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.snippets.label', 'Snippets'),
          description: t(
            'settings.nav.snippets.description',
            'Configure up to 4 quick phrases and their Agent modes.'
          ),
          path: '/settings/appearance/snippets',
          icon: MessageSquareTextIcon,
          pageType: 'complete',
        },
      ],
    },
    {
      label: t('settings.nav.group.advanced', 'Advanced'),
      items: [
        {
          label: t('settings.nav.permissions.label', 'Permissions'),
          description: t(
            'settings.nav.permissions.description',
            'Manage tool permissions, run modes, and audit records; configurable per workspace.'
          ),
          path: '/settings/permissions',
          icon: ShieldCheckIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.environment.label', 'Environment variables'),
          description: t(
            'settings.nav.environment.description',
            'Manage Server and Agent launch configuration separately; stored locally.'
          ),
          path: '/settings/environment',
          icon: BracesIcon,
          pageType: 'complete',
        },
        {
          label: t('settings.nav.server.label', 'Server'),
          description: t(
            'settings.nav.server.description',
            'Manage listening, session capacity, and file logging; restart the app manually after saving.'
          ),
          path: '/settings/server',
          icon: ServerIcon,
          pageType: 'complete',
        },
      ],
    },
    {
      label: t('settings.nav.group.extensions', 'Extensions'),
      items: [
        {
          label: t('settings.nav.extensions.label', 'Extensions'),
          description: t(
            'settings.nav.extensions.description',
            'Extension queries and enable/disable are not available yet.'
          ),
          path: '/settings/extensions',
          icon: BoxesIcon,
          pageType: 'complete',
        },
      ],
    },
    {
      label: t('settings.nav.group.about', 'About'),
      items: [
        {
          label: t('settings.nav.version.label', 'Version'),
          description: t('settings.nav.version.description', 'The version page is not available yet.'),
          path: '/settings/about/version',
          icon: FileBadgeIcon,
          pageType: 'placeholder',
        },
        {
          label: t('settings.nav.company.label', 'Company'),
          description: t('settings.nav.company.description', 'The company page is not available yet.'),
          path: '/settings/about/company',
          icon: Building2Icon,
          pageType: 'placeholder',
        },
        {
          label: t('settings.nav.licenses.label', 'Licenses'),
          description: t(
            'settings.nav.licenses.description',
            'The open-source licenses page is not available yet.'
          ),
          path: '/settings/about/licenses',
          icon: BookOpenIcon,
          pageType: 'placeholder',
        },
      ],
    },
  ];
}

/**
 * Finds navigation metadata for the current route.
 *
 * @param t Project translation function providing localized labels.
 * @param pathname Current browser pathname.
 * @returns Matching navigation item or undefined.
 */
function findSettingsNavigationItem(t: Translate, pathname: string): SettingsNavigationItem | undefined {
  return getSettingsNavigation(t)
    .flatMap((group) => group.items)
    .find((item) => item.path === pathname);
}

/**
 * Reads the same localized navigation catalog for links and the current section header.
 */
export function useSettingsNavigation(pathname?: string) {
  const { t } = useI18n();
  return {
    groups: getSettingsNavigation(t),
    item: pathname === undefined ? undefined : findSettingsNavigationItem(t, pathname),
  };
}
