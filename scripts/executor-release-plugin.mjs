/**
 * @author Codex
 * @description Updates the independent Executor manifest through release-it's supported plugin lifecycle before the shared version commit.
 */
import { Plugin } from 'release-it';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bumpExecutorVersion, incrementExecutorVersion } from './release-versions.mjs';

export default class ExecutorReleasePlugin extends Plugin {
  /**
   * Validates the increment and current version before any release plugin writes its manifest.
   */
  async init() {
    const manifest = JSON.parse(await readFile(join(process.cwd(), 'apps/executor/package.json'), 'utf8'));
    incrementExecutorVersion(manifest.version, this.options.increment);
    this.setContext({ currentVersion: manifest.version });
  }

  /**
   * Writes the Executor version once per new release, skipping dry runs and rejecting a changed input.
   */
  async bump() {
    if (this.config.isDryRun) return;
    const result = await bumpExecutorVersion(process.cwd(), this.options.increment, {
      expectedVersion: this.getContext('currentVersion'),
    });
    this.log.log(`Executor version: ${result.current} → ${result.next}`);
  }
}
