/**
 * @author Codex
 * @description Keeps tool catalog presentation identical in dialogs and inline disclosure panels.
 */

import { cn } from '@octopus/ui/lib/utils';

/**
 * Displays tool names in a responsive grid with shared spacing, surface and typography.
 */
export function ToolNameList({
  names,
  enabledTools,
  showPolicy = false,
}: {
  names: readonly string[];
  enabledTools?: ReadonlySet<string>;
  showPolicy?: boolean;
}) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {names.map((name) => (
        <li
          key={name}
          aria-disabled={showPolicy && enabledTools ? !enabledTools.has(name) : undefined}
          className={cn(
            'flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-xs',
            showPolicy &&
              'border border-border bg-background aria-disabled:border-transparent aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:opacity-60'
          )}
        >
          <span className="min-w-0 break-all font-mono">{name}</span>
          {showPolicy ? (
            <span className="shrink-0 text-muted-foreground">
              {enabledTools ? (enabledTools.has(name) ? '已启用' : '已禁用') : '待确认'}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
