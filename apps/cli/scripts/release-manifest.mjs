/**
 * @author Codex
 * @description Generates the complete public npm manifest from the independent release configuration.
 */

/**
 * Keeps development scripts, workspace dependencies and installer metadata out of the npm bootstrap package.
 * @param {import('../src/distribution/config.ts').ReleaseConfig} config Validated release configuration.
 */
export function createPublicationManifest(config) {
  return {
    ...config.manifest,
    private: false,
    type: 'module',
    bin: { [config.command]: './' + config.bootstrap.destination },
    files: [
      config.bootstrap.destination,
      config.archive,
      'release-layout.json',
      'README.md',
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      ...Object.keys(config.readmeTranslations ?? {}),
    ],
    dependencies: { pnpm: config.pnpmVersion },
  };
}
