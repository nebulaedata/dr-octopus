/**
 * @author Codex
 * @description Validates per-install registries and translates package-manager failures without changing source configuration.
 */
import { gatewayError } from './gateway/index.js';
import { execute } from './process.js';

/**
 * Accepts only HTTP(S) registry URLs and never repeats invalid input in errors.
 */
export function registryUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.hash) {
      throw new Error();
    }
    return url.href;
  } catch {
    throw gatewayError('INVALID_REGISTRY', 'Registry must be a valid HTTP(S) URL without a fragment.');
  }
}

/**
 * Removes URL credentials, queries and common authentication assignments from installer diagnostics.
 */
export function redactInstallOutput(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
      try {
        const url = new URL(match);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.href;
      } catch {
        return '[redacted URL]';
      }
    })
    .replace(/((?:_authToken|_auth|password|token)\s*[=:]\s*)\S+/gi, '$1[redacted]')
    .replace(/(authorization\s*[:=]\s*)(?:Bearer|Basic)\s+\S+/gi, '$1[redacted]');
}

/**
 * Reads pnpm's effective default registry in the same directory used for installation, without network access.
 */
export async function effectiveRegistry(
  pnpm: { command: string; args: string[] },
  root: string,
  override?: string
): Promise<string> {
  if (override) {
    return registryUrl(override);
  }
  try {
    return registryUrl(await execute(pnpm.command, [...pnpm.args, 'config', 'get', 'registry'], root));
  } catch (error) {
    throw gatewayError(
      'REGISTRY_CONFIG_FAILED',
      redactInstallOutput(`Cannot read pnpm registry: ${String(error)}`)
    );
  }
}

/**
 * Classifies only evidenced failures; unknown lifecycle errors retain their original diagnostic.
 */
export function installationFailure(
  error: unknown,
  registry: string,
  command: string,
  explicit = false
): Error {
  const detail = redactInstallOutput(String(error));
  let advice = 'Inspect the package-manager log above.';
  if (/ERR_PNPM_(?:FETCH_)?(?:401|403|404)|ERR_PNPM_NO_MATCHING_VERSION/.test(detail)) {
    advice = 'Check the configured registry, package availability and authentication.';
  } else if (/gyp ERR!|prebuild-install|node-pre-gyp|ERR_PNPM_LIFECYCLE/.test(detail)) {
    advice =
      'Check the failing lifecycle script, native binary download host and local build tools; changing npm registry may not help.';
  } else if (
    /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_SOCKET_TIMEOUT)\b/.test(detail)
  ) {
    advice =
      'Check the download host, network, proxy and configured registry. Retry with --registry <url> if appropriate.';
    if (!explicit && registry === 'https://registry.npmjs.org/') {
      advice += ` For public npm downloads, an alternative is: ${command} deps install --yes --registry https://registry.npmmirror.com`;
    }
  }
  return gatewayError(
    'DEPENDENCY_INSTALL_FAILED',
    `Registry: ${redactInstallOutput(registry)}\n${detail}\n${advice}`
  );
}
