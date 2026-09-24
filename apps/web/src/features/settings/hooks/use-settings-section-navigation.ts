/**
 * @author Claude
 * @description Shares host-owned Settings section navigation with deep page content.
 */

import { createContext, useContext } from 'react';
import type { SettingsPath } from '@/features/settings/hooks/use-settings-navigation';

/**
 * Navigates to another Settings section; the modal host turns it into masked navigation.
 */
export type SettingsSectionNavigate = (path: SettingsPath) => void;

export const SettingsSectionNavigationContext = createContext<SettingsSectionNavigate | undefined>(undefined);

/**
 * Returns the modal host's masked navigation, or undefined on canonical Settings routes.
 *
 * @returns Host-provided section navigation when Settings renders inside the route-masked dialog.
 */
export function useSettingsSectionNavigate(): SettingsSectionNavigate | undefined {
  return useContext(SettingsSectionNavigationContext);
}
