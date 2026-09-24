/**
 * @author Codex
 * @description 渲染 Pi Web 工作台布局、空态路由与 Session 路由组件
 */

import { lazy, Suspense } from 'react';
import { useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { LoadingFallback } from '../components/LoadingFallback';
import { WorkbenchSessionPage as LazyWorkbenchSessionPage } from '@/features/session';
import { SchedulesPage as LazySchedulesPage } from '@/features/schedules';
import { Layout } from '@/features/layout';
import { WorkbenchHomePage } from '@/features/home';
import { WorkbenchWorkspacePage } from '@/features/workspace';
import { useI18n } from '../i18n/use-i18n';
import type { SettingsPath } from './settings-modal';

/**
 * Loads the Skill management feature only for the Skills route.
 */
const loadSkillsPage = async () => {
  const module = await import('@/features/skills');
  return { default: module.SkillsPage };
};

const LazySkillsPage = lazy(loadSkillsPage);

/**
 * Loads the Settings feature inside the Workbench content frame.
 */
const loadSettingsModule = () => import('../features/settings');

const LazySettingsLayout = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.SettingsLayout }))
);
const LazyModelProvidersPage = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.ModelProvidersPage }))
);
const LazyDefaultModelPage = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.DefaultModelPage }))
);
const LazyPermissionsPage = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.PermissionsPage }))
);
const LazyEnvironmentPage = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.EnvironmentPage }))
);
const LazyServerSettingsPage = lazy(() =>
  import('@/features/settings').then((module) => ({
    default: module.ServerSettingsPage,
  }))
);

/**
 * Renders Server settings at its canonical URL with the same editor as the Settings dialog.
 */
export function ServerSettingsRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <LoadingFallback message={t('layout.routeLoading.serverSettings', 'Loading server settings…')} />
      }
    >
      <LazyServerSettingsPage />
    </Suspense>
  );
}
const LazyMcpServersPage = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.McpServersPage }))
);
const LazyExtensionsPage = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.ExtensionsPage }))
);
const LazySchedulerSettingsPage = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.SchedulerSettingsPage }))
);
const LazyKnowledgePage = lazy(() =>
  import('@/features/knowledge').then((module) => ({ default: module.KnowledgePage }))
);

/**
 * Load knowledge Settings independently of conversation code.
 */
const LazyKnowledgeSettingsPage = lazy(() =>
  import('@/features/settings').then((module) => ({
    default: module.KnowledgeSettingsPage,
  }))
);

/**
 * Load knowledge management only when its route is selected.
 */
export function KnowledgeRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={<LoadingFallback message={t('layout.routeLoading.knowledge', 'Loading knowledge base…')} />}
    >
      <LazyKnowledgePage />
    </Suspense>
  );
}

/**
 * Render knowledge model configuration within the existing Settings layout.
 */
export function KnowledgeSettingsRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <LoadingFallback
          message={t('layout.routeLoading.knowledgeSettings', 'Loading knowledge settings…')}
        />
      }
    >
      <LazyKnowledgeSettingsPage />
    </Suspense>
  );
}
const LazySettingsPlaceholderPage = lazy(() =>
  loadSettingsModule().then((module) => ({ default: module.SettingsPlaceholderPage }))
);

/**
 * 渲染仅供工作台页面共享的布局出口。
 */
export function WorkbenchLayoutRoute() {
  return <Layout />;
}

/**
 * 渲染未选择 Session 的工作台。
 */
export function IndexRoute() {
  return <WorkbenchHomePage />;
}

/**
 * Renders one Workspace and its Session list before a child Session is selected.
 */
export function WorkspaceRoute() {
  return <WorkbenchWorkspacePage />;
}

/**
 * 渲染 URL 指定 Session 的工作台。
 */
export function SessionRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={<LoadingFallback message={t('layout.routeLoading.session', 'Loading session module…')} />}
    >
      <LazyWorkbenchSessionPage />
    </Suspense>
  );
}

/**
 * Renders the Workspace-scoped Skill management page.
 */
export function SkillsRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={<LoadingFallback message={t('layout.routeLoading.skills', 'Loading skills module…')} />}
    >
      <LazySkillsPage />
    </Suspense>
  );
}

/**
 * Renders the Settings secondary layout inside Workbench.
 */
export function SettingsLayoutRoute() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<LoadingFallback message={t('layout.routeLoading.settings', 'Loading settings…')} />}>
      <LazySettingsLayout />
    </Suspense>
  );
}

/**
 * Renders the model-provider Settings workspace.
 */
export function ModelProvidersRoute() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: '/settings/model-providers' });
  const search = useSearch({ from: '/workbench/settings/model-providers' });
  return (
    <Suspense
      fallback={
        <LoadingFallback message={t('layout.routeLoading.modelProviders', 'Loading model providers…')} />
      }
    >
      <LazyModelProvidersPage
        provider={search.provider}
        onProviderChange={(provider, options) =>
          void navigate({
            search: provider === undefined ? {} : { provider },
            replace: options?.replace,
          })
        }
      />
    </Suspense>
  );
}

/**
 * Renders global default-model Settings.
 */
export function DefaultModelRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={<LoadingFallback message={t('layout.routeLoading.defaultModel', 'Loading default model…')} />}
    >
      <LazyDefaultModelPage />
    </Suspense>
  );
}

/**
 * Renders per-process environment Settings at its canonical URL.
 */
export function EnvironmentRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <LoadingFallback message={t('layout.routeLoading.environment', 'Loading environment settings…')} />
      }
    >
      <LazyEnvironmentPage />
    </Suspense>
  );
}

/**
 * Renders user-scope MCP Server Settings.
 */
export function McpServersRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={<LoadingFallback message={t('layout.routeLoading.mcpServers', 'Loading MCP servers…')} />}
    >
      <LazyMcpServersPage />
    </Suspense>
  );
}

/**
 * Renders Extension Settings.
 */
export function ExtensionsRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={<LoadingFallback message={t('layout.routeLoading.extensions', 'Loading extensions…')} />}
    >
      <LazyExtensionsPage />
    </Suspense>
  );
}

/**
 * Renders global scheduled-task management in the Workbench.
 */
export function SchedulesRoute() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: '/schedules' });
  const search = useSearch({ from: '/workbench/schedules' });
  return (
    <Suspense
      fallback={<LoadingFallback message={t('layout.routeLoading.schedules', 'Loading scheduled tasks…')} />}
    >
      <LazySchedulesPage
        view={search.tab ?? 'tasks'}
        authorizationTarget={
          search.authorizeTaskId && search.authorizeWorkspaceId
            ? { taskId: search.authorizeTaskId, workspaceId: search.authorizeWorkspaceId }
            : undefined
        }
        onAuthorizationClose={() =>
          void navigate({
            search: (previous) => ({
              ...previous,
              authorizeTaskId: undefined,
              authorizeWorkspaceId: undefined,
            }),
            replace: true,
            resetScroll: false,
          })
        }
        onViewChange={(tab) =>
          void navigate({
            search: (previous) => ({ ...previous, tab }),
            resetScroll: false,
          })
        }
      />
    </Suspense>
  );
}

/**
 * Renders Scheduler service configuration within Settings.
 */
export function SchedulerSettingsRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <LoadingFallback
          message={t('layout.routeLoading.schedulerSettings', 'Loading scheduler settings…')}
        />
      }
    >
      <LazySchedulerSettingsPage />
    </Suspense>
  );
}

/**
 * Renders one deferred Settings module without fake controls.
 */
export function SettingsPlaceholderRoute() {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (state) => state.location.pathname as SettingsPath });
  return (
    <Suspense
      fallback={<LoadingFallback message={t('layout.routeLoading.settingsPage', 'Loading settings page…')} />}
    >
      <LazySettingsPlaceholderPage pathname={pathname} />
    </Suspense>
  );
}

/**
 * Render permission Settings through the existing lazy route boundary.
 */
export function PermissionsRoute() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyPermissionsPage />
    </Suspense>
  );
}

/**
 * Load global memory management without a Workspace or Session prerequisite.
 */
const LazyMemoryPage = lazy(() =>
  import('@/features/memory').then((module) => ({ default: module.MemoryPage }))
);
const LazyMemorySettingsPage = lazy(() =>
  import('@/features/settings').then((module) => ({
    default: module.MemorySettingsPage,
  }))
);
/**
 * Render the global memory route in the shared Workbench shell.
 */
export function MemoryRoute() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<LoadingFallback message={t('layout.routeLoading.memory', 'Loading memory…')} />}>
      <LazyMemoryPage />
    </Suspense>
  );
}

/**
 * Render global memory policy within the shared Settings frame.
 */
export function MemorySettingsRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <LoadingFallback message={t('layout.routeLoading.memorySettings', 'Loading memory settings…')} />
      }
    >
      <LazyMemorySettingsPage />
    </Suspense>
  );
}

const LazyLanguageSettingsPage = lazy(() =>
  import('@/features/settings').then((module) => ({
    default: module.LanguageSettingsPage,
  }))
);
/**
 * Render interface language selection within the shared Settings frame.
 */
export function LanguageSettingsRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <LoadingFallback message={t('layout.routeLoading.languageSettings', 'Loading language settings…')} />
      }
    >
      <LazyLanguageSettingsPage />
    </Suspense>
  );
}

const LazyShortcutsSettingsPage = lazy(() =>
  import('@/features/settings').then((module) => ({
    default: module.ShortcutsSettingsPage,
  }))
);
/**
 * Render keyboard shortcut customization within the shared Settings frame.
 */
export function ShortcutsSettingsRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <LoadingFallback
          message={t('layout.routeLoading.shortcutsSettings', 'Loading keyboard shortcuts…')}
        />
      }
    >
      <LazyShortcutsSettingsPage />
    </Suspense>
  );
}

const LazyJevSettingsPage = lazy(() =>
  import('../features/settings').then((module) => ({ default: module.JevSettingsPage }))
);
/**
 * Render Jev settings through the shared feature entrypoint.
 */
export function JevSettingsRoute() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<LoadingFallback message={t('settings.jev.loading', 'Loading Jev settings…')} />}>
      <LazyJevSettingsPage />
    </Suspense>
  );
}
