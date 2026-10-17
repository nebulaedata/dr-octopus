/**
 * @author Codex
 * @description Resolves the public Executor acceptance-release links independently from the Web version.
 */

interface ExecutorReleaseEnvironment {
  VITE_EXECUTOR_VERSION?: string;
  VITE_EXECUTOR_WINDOWS_INSTALLER_URL?: string;
  VITE_EXECUTOR_WINDOWS_ZIP_URL?: string;
}

export const executorInstallationUrl =
  'https://github.com/nebulaedata/dr-octopus/blob/main/apps/executor/INSTALLATION.md';

/**
 * Accepts public HTTP(S) links and same-origin absolute paths; unavailable links stay disabled.
 */
function downloadUrl(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || candidate.includes('\\') || /\p{Cc}/u.test(candidate)) {
    return undefined;
  }
  try {
    const url = new URL(candidate, 'https://executor-download.invalid');
    const isAbsolutePath = candidate.startsWith('/') && !candidate.startsWith('//');
    const isHttpUrl = /^https?:\/\//i.test(candidate);
    if ((!isAbsolutePath && !isHttpUrl) || !['http:', 'https:'].includes(url.protocol)) {
      return undefined;
    }
    if (url.username || url.password) {
      return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}

/**
 * Reads build-time public configuration; the current Executor distribution is an unsigned acceptance build.
 */
export function readExecutorRelease(environment: ExecutorReleaseEnvironment) {
  return {
    version: environment.VITE_EXECUTOR_VERSION?.trim() || '0.0.1',
    installerUrl: downloadUrl(environment.VITE_EXECUTOR_WINDOWS_INSTALLER_URL),
    archiveUrl: downloadUrl(environment.VITE_EXECUTOR_WINDOWS_ZIP_URL),
  };
}
