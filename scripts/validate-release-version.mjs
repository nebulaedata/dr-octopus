/**
 * @author Codex
 * @description Validates both product version targets before release-it modifies files or Git state.
 */
import { planReleaseVersions } from './release-versions.mjs';

try {
  await planReleaseVersions(process.cwd(), {
    increment: process.argv[2],
    executorIncrement: 'patch',
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
