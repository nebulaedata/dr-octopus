/**
 * @author Codex
 * @description Renders an ordered, configurable Composer toolbar with shared item mounting across desktop and mobile modes.
 */

import { Fragment } from 'react';
import { useResponsive } from 'ahooks';
import type { ReactNode } from 'react';

export type ComposerToolbarMode = 'desktop' | 'mobile';

export interface ComposerToolbarItem {
  id: string;
  area?: 'leading' | 'trailing';
  visible?: boolean;
  modes?: readonly ComposerToolbarMode[];
  /**
   * Renders the same control instance with mode-specific presentation; stable IDs preserve its state.
   */
  render(mode: ComposerToolbarMode): ReactNode;
}

export interface ComposerToolbarProps {
  items: readonly ComposerToolbarItem[];
  mode?: ComposerToolbarMode;
}

/**
 * Keeps item ordering, visibility and responsive mounting in one presentation-only component.
 *
 * @param mode Explicit layout override; otherwise follows the existing 768px mobile breakpoint.
 */
export function ComposerToolbar({ items, mode }: ComposerToolbarProps) {
  const responsive = useResponsive();
  const activeMode = mode ?? (responsive.md ? 'desktop' : 'mobile');
  const mountedItems = items.filter(
    (item) => item.visible !== false && (item.modes === undefined || item.modes.includes(activeMode))
  );

  /**
   * Applies the same item contract in both toolbar areas without duplicating responsive button trees.
   */
  function renderArea(area: 'leading' | 'trailing') {
    return mountedItems
      .filter((item) => (item.area ?? 'leading') === area)
      .map((item) => <Fragment key={item.id}>{item.render(activeMode)}</Fragment>);
  }

  return (
    <div
      role="toolbar"
      aria-label="Composer tools"
      data-mode={activeMode}
      className="flex min-w-0 flex-nowrap items-center gap-1 p-2"
    >
      <div className="flex min-w-0 items-center gap-1">{renderArea('leading')}</div>
      <div className="ml-auto flex shrink-0 items-center gap-1">{renderArea('trailing')}</div>
    </div>
  );
}
