/**
 * @author Codex
 * @description Renders a horizontal navigation menu from a declarative list of items.
 */

import { Link } from '@tanstack/react-router';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@octopus/ui/components/navigation-menu';
import { cn } from '@octopus/ui/lib/utils';

export interface NavMenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  to?: string;
  params?: Record<string, string>;
  active?: boolean;
  disabled?: boolean;
  onClick?(): void;
}

export interface NavMenuProps {
  items: NavMenuItem[];
}

/**
 * Builds one accessible navigation link with active and disabled states.
 */
function NavMenuLink({ item }: { item: NavMenuItem }) {
  const className = cn(
    navigationMenuTriggerStyle(),
    'inline-flex gap-1.5',
    item.active && 'bg-muted/50',
    item.disabled && 'pointer-events-none text-muted-foreground opacity-60 hover:bg-transparent'
  );

  const content = (
    <>
      {item.icon}
      {item.label}
    </>
  );

  const render = item.disabled ? (
    <span className={className}>{content}</span>
  ) : item.to ? (
    <Link
      to={item.to as '/'}
      params={item.params as never}
      activeOptions={{ exact: true }}
      className={className}
      onClick={item.onClick}
    >
      {content}
    </Link>
  ) : (
    <button type="button" className={className} onClick={item.onClick}>
      {content}
    </button>
  );

  return <NavigationMenuLink active={item.active} aria-disabled={item.disabled} render={render} />;
}

/**
 * Presents a compact, centered navigation menu.
 */
export function NavMenu({ items }: NavMenuProps) {
  return (
    <NavigationMenu>
      <NavigationMenuList className="gap-2">
        {items.map((item) => (
          <NavigationMenuItem key={item.id}>
            <NavMenuLink item={item} />
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
