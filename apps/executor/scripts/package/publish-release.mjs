/**
 * @author Codex
 * @description Publishes the current workflow's verified unsigned Executor assets to an existing exact-source GitHub Release.
 */
import { parseArgs } from 'node:util';
import { appendFile } from 'node:fs/promises';
import { prepareReleaseAssets, publishReleaseAssets } from '../lib/package/release-assets.mjs';

const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    repository: { type: 'string' },
    tag: { type: 'string' },
    'source-commit': { type: 'string' },
  },
});
if (!values.directory) {
  throw new Error('A verified delivery directory is required.');
}
const delivery = await prepareReleaseAssets(values.directory, {
  repository: values.repository,
  tag: values.tag,
  sourceCommit: values['source-commit'],
});
const result = await publishReleaseAssets(delivery, { token: process.env.GH_TOKEN });
console.log(JSON.stringify(result));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `# Executor Release assets\n\nRelease: ${result.releaseUrl}\n\nProduct build: ${result.productBuildId}\n\nUploaded: ${result.uploaded.length}; identical assets retained: ${result.retained}.\n\nUnsigned acceptance build; installation, hardware acceptance and signing remain pending.\n`
  );
}
