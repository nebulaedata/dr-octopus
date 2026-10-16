/**
 * @author Codex
 * @description Keeps tool catalog presentation identical in dialogs and inline disclosure panels.
 */

/**
 * Displays tool names in a responsive grid with shared spacing, surface and typography.
 */
export function ToolNameList({ names }: { names: readonly string[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {names.map((name) => (
        <li key={name} className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs break-all">
          {name}
        </li>
      ))}
    </ul>
  );
}
