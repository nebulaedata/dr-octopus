/**
 * @author Codex
 * @description Owns the typed hash route tree for the packaged executor UI.
 */
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { ExecutorLayout } from '@/features/layout';

const rootRoute = createRootRoute({ component: Outlet });
const executorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ExecutorLayout,
});

export const router = createRouter({
  history: createHashHistory(),
  routeTree: rootRoute.addChildren([executorRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
