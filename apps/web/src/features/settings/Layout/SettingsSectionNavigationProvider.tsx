/**
 * @author Codex
 * @description Supplies host-owned section navigation without moving its state into the view.
 */
import { SettingsSectionNavigationContext } from '../hooks/use-settings-section-navigation';
import type { SettingsSectionNavigate } from '../hooks/use-settings-section-navigation';
import type { ReactNode } from 'react';
/**
 * Preserves the optional navigation value used by canonical and masked Settings pages.
 */
export function SettingsSectionNavigationProvider({
  value,
  children,
}: {
  value?: SettingsSectionNavigate;
  children: ReactNode;
}) {
  return (
    <SettingsSectionNavigationContext.Provider value={value}>
      {children}
    </SettingsSectionNavigationContext.Provider>
  );
}
