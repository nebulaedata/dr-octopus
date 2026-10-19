/**
 * @author Codex
 * @description Runs release-it's version-only API with explicit repository and Executor increments after the unified publisher approves the plan.
 */
import { Command, Option } from 'commander';
import release from 'release-it';

const options = new Command('bump-release.mjs')
  .requiredOption('--increment <version>', 'Approved repository version or increment')
  .addOption(
    new Option('--executor-increment <level>', 'Approved Executor increment')
      .choices(['patch', 'minor', 'major'])
      .makeOptionMandatory()
  )
  .parse()
  .opts();

try {
  await release({
    onlyVersion: true,
    ci: true,
    increment: options.increment,
    plugins: { './scripts/executor-release-plugin.mjs': { increment: options.executorIncrement } },
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
