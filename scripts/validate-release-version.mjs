/**
 * @author Codex
 * @description Rejects an unchanged release version before release-it modifies files or Git state.
 */
import { readFileSync } from 'node:fs';

const current = JSON.parse(readFileSync('release.config.json', 'utf8')).manifest.version;
const next = process.argv[2];
if (!next || next === current) {
  console.error(
    `Select a new version instead of ${current}. To retry ${current}, run pnpm release:publish --resume with a clean working tree.`
  );
  process.exit(1);
}
