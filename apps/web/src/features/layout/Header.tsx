/**
 * @author Codex
 * @description Renders the common application header, global workbench navigation, and active Session summary.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import {
  BookOpenIcon,
  BrainIcon,
  ChevronDownIcon,
  ClockIcon,
  FolderOpenIcon,
  MessageSquareIcon,
  PaletteIcon,
  PanelLeftOpenIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { useSidebar } from '@octopus/ui/components/sidebar';
import { formatSessionCreated } from '@/utils/date';
import { Button } from '@octopus/ui/components/button';
import { ThemeMenu } from '@octopus/ui/components/theme-menu';
import { Logo } from '@/components/Logo';
import { HeaderTitle } from '@/components/HeaderTitle';
import { NotificationCenter } from './NotificationCenter';
import { NavMenu } from '@/components/NavMenu';
import { Separator } from '@octopus/ui/components/separator';
import { useI18n } from '@/i18n/use-i18n';
import type { SessionDto } from '@octopus/shared/protocol';

export interface HeaderProps {
  session?: SessionDto;
  workspaceId?: string;
  filesPanelOpen?: boolean;
  onToggleFilesPanel?(): void;
}

/**
 * Keeps Header placement stable while adapting controls to the active route.
 */
export function Header({ session, workspaceId, filesPanelOpen, onToggleFilesPanel }: HeaderProps) {
  const { t } = useI18n();
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const sidebarOpen = isMobile ? openMobile : open;
  const settingsActive = pathname.startsWith('/settings');
  const schedulesActive = pathname === '/schedules';
  const memoryActive = pathname === '/memory';

  return (
    <header
      data-open={sidebarOpen}
      className="flex min-h-17 min-w-0 items-center gap-1.5 border-b px-2 py-2.5 sm:gap-2.5 sm:px-4 md:px-6 data-[open=false]:pl-2 sm:data-[open=false]:pl-3.5"
    >
      {!sidebarOpen && (
        <div role="banner" className="flex shrink-0 items-center gap-3">
          <Logo size="sm" />
          <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={toggleSidebar}>
            <PanelLeftOpenIcon />
          </Button>
          <Separator orientation="vertical" className="mx-1 h-4 self-center! sm:mx-3" />
        </div>
      )}
      {memoryActive && (
        <HeaderPlaceholder
          title={t('layout.header.memoryTitle', 'Memory')}
          description={t('layout.header.memoryDescription', 'Long-term memory shared across workspaces')}
        />
      )}
      {settingsActive && (
        <HeaderPlaceholder
          title={t('layout.header.settingsTitle', 'Settings')}
          description={t('layout.header.settingsDescription', 'Global agent configuration')}
        />
      )}
      {schedulesActive && (
        <HeaderPlaceholder
          title={t('layout.header.schedulesTitle', 'Scheduled tasks')}
          description={t('layout.header.schedulesDescription', 'Manage scheduled tasks across workspaces')}
        />
      )}
      {!settingsActive && !schedulesActive && !memoryActive && session ? (
        <ActiveSessionHeader session={session} />
      ) : null}
      {!settingsActive && !schedulesActive && !memoryActive && session === undefined ? (
        <HeaderPlaceholder />
      ) : null}
      <div role="navigation" className="flex shrink-0 items-center justify-end">
        <div className="hidden lg:block">
          <WorkbenchNavMenu
            session={session}
            workspaceId={workspaceId}
            filesPanelOpen={filesPanelOpen}
            onToggleFilesPanel={onToggleFilesPanel}
          />
        </div>
        <Button
          className="lg:hidden"
          variant="ghost"
          aria-label="Memory"
          nativeButton={false}
          render={<Link to="/memory" />}
        >
          <BrainIcon />
        </Button>
        <NotificationCenter />
        <ThemeMenu
          i18n={{
            colorThemeGroupLabel: t('layout.header.themeMenu.colorThemeGroupLabel', 'Color theme'),
            modeGroupLabel: t('layout.header.themeMenu.modeGroupLabel', 'Theme mode'),
            colorThemeLabels: {
              default: t('layout.header.themeMenu.colorThemeDefault', 'Default'),
              electric: t('layout.header.themeMenu.colorThemeElectric', 'Electric indigo'),
              shadcn: t('layout.header.themeMenu.colorThemeShadcn', 'shadcn classic'),
            },
            modeLabels: {
              system: t('layout.header.themeMenu.modeSystem', 'System'),
              light: t('layout.header.themeMenu.modeLight', 'Light'),
              dark: t('layout.header.themeMenu.modeDark', 'Dark'),
            },
          }}
          render={(activeColorTheme, activeMode) => (
            <Button
              variant="ghost"
              aria-label="Switch color theme and mode"
              className="ml-2"
              title={`${activeColorTheme.label}; ${activeMode.label}`}
            >
              <PaletteIcon data-icon="inline-start" />
              <span className="hidden sm:inline">{t('layout.header.theme', 'Theme')}</span>
              <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
            </Button>
          )}
        />
      </div>
    </header>
  );
}

/**
 * Presents a useful title when no Session route is active.
 */
function HeaderPlaceholder({ title, description }: { title?: string; description?: string }) {
  const { t } = useI18n();
  return (
    <HeaderTitle
      title={title ?? t('layout.header.defaultTitle', 'Agent')}
      description={description ?? 'Dr.Octopus'}
    />
  );
}

/**
 * Presents summary metadata scoped to the exact active Session.
 */
function ActiveSessionHeader({ session }: { session: SessionDto }) {
  const { t } = useI18n();
  return (
    <HeaderTitle
      title={session.title}
      description={t('layout.header.createdOn', 'Created on {{date}}', {
        date: formatSessionCreated(session.createdAt),
      })}
    />
  );
}

/**
 * Builds the declarative menu list for the workbench header.
 */
function WorkbenchNavMenu({ session, workspaceId, filesPanelOpen, onToggleFilesPanel }: HeaderProps) {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isSessionRoute = /^\/workspaces\/[^/]+\/sessions\/[^/]+\/?$/.test(pathname);
  const isAgentHomeRoute = pathname === '/' || /^\/workspaces\/[^/]+\/?$/.test(pathname);
  const isSkillsRoute = /^\/workspaces\/[^/]+\/(?:skills|sessions\/[^/]+\/skills)\/?$/.test(pathname);
  const isSchedulesRoute = pathname === '/schedules';
  let chatTo: '/workspaces/$workspaceId/sessions/$sessionId' | '/workspaces/$workspaceId' | '/';
  if (session !== undefined) {
    chatTo = '/workspaces/$workspaceId/sessions/$sessionId';
  } else if (workspaceId !== undefined) {
    chatTo = '/workspaces/$workspaceId';
  } else {
    chatTo = '/';
  }
  let chatParams: Record<string, string> | undefined;
  if (session !== undefined) {
    chatParams = { workspaceId: session.workspaceId, sessionId: session.id };
  } else if (workspaceId !== undefined) {
    chatParams = { workspaceId };
  } else {
    chatParams = undefined;
  }
  // Resource pages retain the Session in the URL so chat, sibling pages and the sidebar stay anchored.
  const skillsTo =
    session === undefined
      ? '/workspaces/$workspaceId/skills'
      : '/workspaces/$workspaceId/sessions/$sessionId/skills';
  const knowledgeTo =
    session === undefined
      ? '/workspaces/$workspaceId/knowledge'
      : '/workspaces/$workspaceId/sessions/$sessionId/knowledge';
  let resourceParams: Record<string, string> | undefined;
  if (session !== undefined) {
    resourceParams = { workspaceId: session.workspaceId, sessionId: session.id };
  } else if (workspaceId === undefined) {
    resourceParams = undefined;
  } else {
    resourceParams = { workspaceId };
  }

  return (
    <NavMenu
      items={[
        {
          id: 'chat',
          label: t('layout.header.nav.chat', 'Chat'),
          icon: <MessageSquareIcon data-icon="inline-start" />,
          to: chatTo,
          params: chatParams,
          active: isSessionRoute || isAgentHomeRoute,
        },
        {
          id: 'files',
          label: t('layout.header.nav.files', 'Files'),
          icon: <FolderOpenIcon data-icon="inline-start" />,
          active: filesPanelOpen,
          onClick: () => onToggleFilesPanel?.(),
        },
        {
          id: 'skills',
          label: t('layout.header.nav.skills', 'Skills'),
          icon: <WandSparklesIcon data-icon="inline-start" />,
          to: skillsTo,
          params: resourceParams,
          active: isSkillsRoute,
          disabled: resourceParams === undefined,
        },
        {
          id: 'knowledge',
          label: t('layout.header.nav.knowledge', 'Knowledge'),
          icon: <BookOpenIcon data-icon="inline-start" />,
          to: knowledgeTo,
          params: resourceParams,
          active: /^\/workspaces\/[^/]+\/(?:knowledge|sessions\/[^/]+\/knowledge)\/?$/u.test(pathname),
          disabled: resourceParams === undefined,
        },
        {
          id: 'memory',
          label: t('layout.header.nav.memory', 'Memory'),
          icon: <BrainIcon data-icon="inline-start" />,
          to: '/memory',
          active: pathname === '/memory',
        },
        {
          id: 'cron',
          label: t('layout.header.nav.schedules', 'Scheduled tasks'),
          icon: <ClockIcon data-icon="inline-start" />,
          to: '/schedules',
          active: isSchedulesRoute,
        },
      ]}
    />
  );
}
