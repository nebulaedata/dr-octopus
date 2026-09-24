/**
 * @author Claude Code
 * @description Presentation helpers shared by the Skills management feature.
 */

/**
 * Renders a byte count as a compact human-readable size.
 *
 * @param bytes Non-negative byte count reported by the Server.
 * @returns Localized size such as "512 B" or "1.5 MB".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? value : Math.round(value * 10) / 10;
  return `${String(rounded)} ${units[unitIndex]}`;
}
