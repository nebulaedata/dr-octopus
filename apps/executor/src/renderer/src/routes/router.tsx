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
import { ConnectionOverview } from '@/features/connection';

const rootRoute = createRootRoute({ component: Outlet });
const connectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ConnectionOverview,
});

export const router = createRouter({
  history: createHashHistory(),
  routeTree: rootRoute.addChildren([connectionRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
