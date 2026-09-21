/**
 * @author Claude
 * @description Renders a cross-section Settings link that stays inside the route-masked dialog when present.
 */

import { Link } from '@tanstack/react-router';
import { cn } from '@octopus/ui/lib/utils';
import { useSettingsSectionNavigate } from './settings-section-navigation';
import type { SettingsPath } from '../settings-navigation';
import type { ReactNode } from 'react';

export interface SettingsSectionLinkProps {
  /** Canonical Settings path to navigate to. */
  path: SettingsPath;
  children: ReactNode;
  className?: string;
}

/**
 * Renders a real link on canonical routes and host-driven masked navigation inside the Settings dialog.
 */
export function SettingsSectionLink({ path, children, className }: SettingsSectionLinkProps) {
  const navigate = useSettingsSectionNavigate();
  if (navigate === undefined) {
    return (
      <Link to={path} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cn('cursor-pointer', className)} onClick={() => navigate(path)}>
      {children}
    </button>
  );
}
