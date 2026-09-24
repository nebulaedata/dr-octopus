/**
 * @author Codex
 * @description 定义 Workspace 与 Session 可分享 URL 的 TanStack Router
 *
 * 技能与知识库均支持 Workspace 和 Session 两种入口；带 Session ID 的入口保留会话选中态。
 */

import { createRootRouteWithContext, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import {
  DefaultModelRoute,
  EnvironmentRoute,
  ServerSettingsRoute,
  PermissionsRoute,
  ExtensionsRoute,
  IndexRoute,
  KnowledgeRoute,
  KnowledgeSettingsRoute,
  LanguageSettingsRoute,
  ModelProvidersRoute,
  McpServersRoute,
  SessionRoute,
  SchedulesRoute,
  MemoryRoute,
  MemorySettingsRoute,
  JevSettingsRoute,
  SchedulerSettingsRoute,
  SettingsLayoutRoute,
  SettingsPlaceholderRoute,
  ShortcutsSettingsRoute,
  SkillsRoute,
  WorkbenchLayoutRoute,
  WorkspaceRoute,
} from './routes';
import { settingsModalSearchSchema } from './settings-modal';
import { prewarmGeneralHome, prewarmWorkspaceHome } from './home-prewarm';
import { queryClient } from '@/queries/core/query-client';
import type { QueryClient } from '@tanstack/react-query';

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()();

/**
 * Shared Workbench search state that child routes inherit.
 */
const workbenchSearchSchema = z.object({
  sideright: z.enum(['file-explorer', 'properties-panel']).optional(),
  settings: settingsModalSearchSchema.optional(),
});

const workbenchLayoutRoute = createRoute({
  id: 'workbench',
  getParentRoute: () => rootRoute,
  component: WorkbenchLayoutRoute,
  validateSearch: workbenchSearchSchema,
});

const indexRoute = createRoute({
  path: '/',
  getParentRoute: () => workbenchLayoutRoute,
  component: IndexRoute,
  loader: ({ cause, context }) => {
    // 推测性导航不创建昂贵的后台资源，用户实际进入后才创建，用于避免仅预加载页面时就创建 Agent 子进程。
    // cause 表示这次 loader 为什么被执行。TanStack Router 当前主要有三种值：
    // - enter：用户真正进入该路由。
    // - stay：已经处于该路由，但路由因失效、搜索参数变化等重新加载。
    // - preload：路由仅被预加载，用户尚未进入，例如鼠标移动到 “新会话” Link，TanStack Router 可能提前加载目标路由代码和数据。
    if (cause !== 'preload') {
      prewarmGeneralHome(context.queryClient);
    }
  },
});

const workspaceRoute = createRoute({
  path: 'workspaces/$workspaceId',
  getParentRoute: () => workbenchLayoutRoute,
  component: WorkspaceRoute,
  loader: ({ cause, context, params }) => {
    if (cause !== 'preload') {
      prewarmWorkspaceHome(context.queryClient, params.workspaceId);
    }
  },
});

const sessionRoute = createRoute({
  path: 'workspaces/$workspaceId/sessions/$sessionId',
  getParentRoute: () => workbenchLayoutRoute,
  component: SessionRoute,
});

const skillsRoute = createRoute({
  path: 'workspaces/$workspaceId/skills',
  getParentRoute: () => workbenchLayoutRoute,
  component: SkillsRoute,
});

const sessionSkillsRoute = createRoute({
  path: 'workspaces/$workspaceId/sessions/$sessionId/skills',
  getParentRoute: () => workbenchLayoutRoute,
  component: SkillsRoute,
});

const memoryRoute = createRoute({
  path: 'memory',
  getParentRoute: () => workbenchLayoutRoute,
  component: MemoryRoute,
});

const schedulesRoute = createRoute({
  path: 'schedules',
  getParentRoute: () => workbenchLayoutRoute,
  component: SchedulesRoute,
  validateSearch: z.object({
    tab: z.enum(['tasks', 'history']).optional().catch(undefined),
    authorizeTaskId: z.string().trim().min(1).max(500).optional().catch(undefined),
    authorizeWorkspaceId: z.string().trim().min(1).max(500).optional().catch(undefined),
  }),
});

/**
 * Knowledge catalog search state shared by the Workspace and Session entries.
 */
const knowledgeSearchSchema = z.object({
  scope: z.enum(['workspace', 'global']).optional().catch(undefined),
  collection: z.string().trim().min(1).max(500).optional().catch(undefined),
});

const settingsLayoutRoute = createRoute({
  path: 'settings',
  getParentRoute: () => workbenchLayoutRoute,
  component: SettingsLayoutRoute,
});

const settingsIndexRoute = createRoute({
  path: '/',
  getParentRoute: () => settingsLayoutRoute,
  beforeLoad: () => {
    throw redirect({ to: '/settings/model-providers' });
  },
});

const modelProvidersRoute = createRoute({
  path: 'model-providers',
  getParentRoute: () => settingsLayoutRoute,
  validateSearch: z.object({ provider: z.string().optional() }),
  component: ModelProvidersRoute,
});

const defaultModelRoute = createRoute({
  path: 'default-model',
  getParentRoute: () => settingsLayoutRoute,
  component: DefaultModelRoute,
});

const extensionsRoute = createRoute({
  path: 'extensions',
  getParentRoute: () => settingsLayoutRoute,
  component: ExtensionsRoute,
});

const mcpServersRoute = createRoute({
  path: 'mcp',
  getParentRoute: () => settingsLayoutRoute,
  component: McpServersRoute,
});

const placeholderSettingsPaths = [
  'appearance/theme',
  'appearance/snippets',
  'about/version',
  'about/company',
  'about/licenses',
] as const;
const schedulerSettingsRoute = createRoute({
  path: 'schedules',
  getParentRoute: () => settingsLayoutRoute,
  component: SchedulerSettingsRoute,
});
const knowledgeSettingsRoute = createRoute({
  path: 'knowledge',
  getParentRoute: () => settingsLayoutRoute,
  component: KnowledgeSettingsRoute,
});
const memorySettingsRoute = createRoute({
  path: 'memory',
  getParentRoute: () => settingsLayoutRoute,
  component: MemorySettingsRoute,
});
const languageSettingsRoute = createRoute({
  path: 'appearance/language',
  getParentRoute: () => settingsLayoutRoute,
  component: LanguageSettingsRoute,
});
const shortcutsSettingsRoute = createRoute({
  path: 'appearance/shortcuts',
  getParentRoute: () => settingsLayoutRoute,
  component: ShortcutsSettingsRoute,
});
const workspaceKnowledgeRoute = createRoute({
  path: 'workspaces/$workspaceId/knowledge',
  getParentRoute: () => workbenchLayoutRoute,
  component: KnowledgeRoute,
  validateSearch: knowledgeSearchSchema,
});
const sessionKnowledgeRoute = createRoute({
  path: 'workspaces/$workspaceId/sessions/$sessionId/knowledge',
  getParentRoute: () => workbenchLayoutRoute,
  component: KnowledgeRoute,
  validateSearch: knowledgeSearchSchema,
});
const permissionsRoute = createRoute({
  path: 'permissions',
  getParentRoute: () => settingsLayoutRoute,
  component: PermissionsRoute,
});
const environmentRoute = createRoute({
  path: 'environment',
  getParentRoute: () => settingsLayoutRoute,
  component: EnvironmentRoute,
});
const jevSettingsRoute = createRoute({
  path: 'jev',
  getParentRoute: () => settingsLayoutRoute,
  component: JevSettingsRoute,
});
const serverSettingsRoute = createRoute({
  path: 'server',
  getParentRoute: () => settingsLayoutRoute,
  component: ServerSettingsRoute,
});
const placeholderSettingsRoutes = placeholderSettingsPaths.map((path) =>
  createRoute({ path, getParentRoute: () => settingsLayoutRoute, component: SettingsPlaceholderRoute })
);

const routeTree = rootRoute.addChildren([
  workbenchLayoutRoute.addChildren([
    indexRoute,
    workspaceRoute,
    sessionRoute,
    skillsRoute,
    sessionSkillsRoute,
    schedulesRoute,
    memoryRoute,
    workspaceKnowledgeRoute,
    sessionKnowledgeRoute,
    settingsLayoutRoute.addChildren([
      settingsIndexRoute,
      modelProvidersRoute,
      defaultModelRoute,
      extensionsRoute,
      mcpServersRoute,
      schedulerSettingsRoute,
      knowledgeSettingsRoute,
      memorySettingsRoute,
      jevSettingsRoute,
      languageSettingsRoute,
      shortcutsSettingsRoute,
      environmentRoute,
      serverSettingsRoute,
      permissionsRoute,
      ...placeholderSettingsRoutes,
    ]),
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient } });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
