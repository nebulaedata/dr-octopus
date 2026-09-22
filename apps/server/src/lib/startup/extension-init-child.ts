/**
 * @author Codex
 * @description Installs required extensions sequentially with visible progress and fails on the first installation error.
 */
import { ensureExtensionsInstalled, getExtensionInstallationStatus } from '@octopus/agent';
import type { EnsureExtensionsResult } from '@octopus/agent';

process.once('message', (message: { agentDir: string }) => {
  void initialize(message.agentDir);
});

/**
 * Waits for each required extension without a deadline and reports progress through inherited stdout.
 * Already installed sources are checked too, preserving their required configuration repairs.
 */
async function initialize(agentDir: string): Promise<void> {
  try {
    const status = getExtensionInstallationStatus({ agentDir });
    const result: EnsureExtensionsResult = { alreadyInstalled: [], installed: [], failures: [] };
    for (const source of [...status.installed, ...status.missing]) {
      const installing = status.missing.includes(source);
      const startedAt = Date.now();
      if (installing) {
        console.log(`[extensions] Installing ${source}`);
      }
      const progress = setInterval(() => {
        console.log(
          `[extensions] Waiting for ${source} (${Math.floor((Date.now() - startedAt) / 1000)}s elapsed)`
        );
      }, 10_000);
      try {
        const installed = await ensureExtensionsInstalled({ agentDir, sources: [source] });
        if (installed.failures.length > 0) {
          throw new Error(
            `${source}: ${installed.failures.map((failure) => String(failure.error)).join('; ')}`
          );
        }
        result.alreadyInstalled.push(...installed.alreadyInstalled);
        result.installed.push(...installed.installed);
        if (installing) {
          console.log(`[extensions] Installed ${source}`);
        }
      } finally {
        clearInterval(progress);
      }
    }
    console.log('[extensions] All required extensions are ready');
    process.send?.({ result }, () => process.exit(0));
  } catch (error) {
    console.error(`[extensions] Installation failed: ${String(error)}`);
    process.send?.({ error: String(error) }, () => process.exit(1));
  }
}
