/**
 * @author Codex
 * @description Generates public Executor download defaults for the exact repository Release being built.
 */
interface ExecutorDownloadEnvironment {
  VITE_EXECUTOR_VERSION?: string;
  VITE_EXECUTOR_WINDOWS_INSTALLER_URL?: string;
  VITE_EXECUTOR_WINDOWS_ZIP_URL?: string;
}

/**
 * Keeps the Executor product version independent while binding default URLs to the site's Release tag.
 * Explicit URL overrides are retained, including empty values that disable an individual download format.
 */
export function executorReleaseDefines(
  releaseVersion: string,
  executorVersion: string,
  environment: ExecutorDownloadEnvironment
) {
  const version = environment.VITE_EXECUTOR_VERSION?.trim() || executorVersion;
  const base = `https://github.com/nebulaedata/dr-octopus/releases/download/v${releaseVersion}`;
  const stem = `Dr.Octopus-Executor-${version}-win-x64-unsigned`;
  return {
    'import.meta.env.VITE_EXECUTOR_VERSION': JSON.stringify(version),
    'import.meta.env.VITE_EXECUTOR_WINDOWS_INSTALLER_URL': JSON.stringify(
      environment.VITE_EXECUTOR_WINDOWS_INSTALLER_URL ?? `${base}/${stem}.exe`
    ),
    'import.meta.env.VITE_EXECUTOR_WINDOWS_ZIP_URL': JSON.stringify(
      environment.VITE_EXECUTOR_WINDOWS_ZIP_URL ?? `${base}/${stem}.zip`
    ),
  };
}
