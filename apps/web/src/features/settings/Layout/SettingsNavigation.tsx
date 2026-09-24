/**
 * @author Codex
 * @description Renders grouped Settings secondary navigation inside Workbench or a mobile Sheet.
 */

import { Link } from '@tanstack/react-router';
import { Button, buttonVariants } from '@octopus/ui/components/button';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { cn } from '@octopus/ui/lib/utils';
import { useSettingsNavigation } from '@/features/settings/hooks/use-settings-navigation';
import type { SettingsPath } from '@/features/settings/hooks/use-settings-navigation';

export interface SettingsNavigationProps {
  pathname: SettingsPath;
  className?: string;
  /**
   * Replaces canonical links with host-controlled modal navigation.
   */
  onNavigate?(path: SettingsPath): void;
  /**
   * Closes transient navigation surfaces after a destination is selected.
   */
  onAfterNavigate?(): void;
}

/**
 * Presents the complete Settings information architecture without replacing the Workbench Sidebar.
 */
export function SettingsNavigation({
  pathname,
  className,
  onNavigate,
  onAfterNavigate,
}: SettingsNavigationProps) {
  const { groups: settingsNavigation } = useSettingsNavigation();
  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-4 p-3" aria-label="Settings sections">
          {settingsNavigation.map((group, groupIndex) => (
            <div className="flex flex-col gap-1" key={group.label ?? `standalone-${groupIndex}`}>
              {group.label === undefined ? null : (
                <p className="px-2 text-xs font-medium text-muted-foreground">{group.label}</p>
              )}
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const className = cn(
                    buttonVariants({
                      variant: 'ghost',
                      className: 'w-full justify-start',
                    }),
                    pathname === item.path && 'bg-sidebar-accent text-sidebar-accent-foreground'
                  );
                  const content = (
                    <>
                      <item.icon />
                      <span>{item.label}</span>
                    </>
                  );
                  return onNavigate === undefined ? (
                    <Link
                      key={item.path}
                      to={item.path}
                      aria-current={pathname === item.path ? 'page' : undefined}
                      onClick={onAfterNavigate}
                      className={className}
                    >
                      {content}
                    </Link>
                  ) : (
                    <Button
                      key={item.path}
                      variant="ghost"
                      aria-current={pathname === item.path ? 'page' : undefined}
                      onClick={() => {
                        onNavigate(item.path);
                        onAfterNavigate?.();
                      }}
                      className={className}
                    >
                      {content}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>
    </div>
  );
}
