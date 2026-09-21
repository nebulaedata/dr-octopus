/**
 * @author Codex
 * @description Adapts canonical Settings child routes to the shared Settings frame.
 */

import { Outlet, useRouterState } from '@tanstack/react-router';
import { SettingsFrame } from './SettingsFrame';
import type { SettingsPath } from '../settings-navigation';

/**
 * Keeps Settings inside the Workbench main panel while child pages change.
 */
export function SettingsLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname as SettingsPath });
  return (
    <SettingsFrame pathname={pathname}>
      <Outlet />
    </SettingsFrame>
  );
}
