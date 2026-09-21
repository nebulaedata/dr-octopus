/**
 * @author Codex
 * @description Locate the built pre-entry Windows guard for source and distribution callers.
 */

/**
 * Return an import URL within the same installed Agent build.
 */
export function resolvePlatformGuard(): string {
  return new URL(
    import.meta.url.endsWith('.ts')
      ? '../../../dist/lib/daemon-platform/windows-broker-guard.js'
      : './windows-broker-guard.js',
    import.meta.url
  ).href;
}
