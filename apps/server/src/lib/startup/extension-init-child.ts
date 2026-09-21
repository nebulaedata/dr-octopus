/**
 * @author Codex
 * @description Isolates startup npm extension installation so Server cancellation can reclaim only its installer tree.
 */
import {
  ensureExtensionsInstalled,
  getExtensionInstallationStatus,
  isExtensionRegistryAvailable,
} from '@octopus/agent';

process.once('message', (message: { agentDir: string }) => {
  void initialize(message.agentDir);
});

/**
 * Reports missing extensions quickly while offline and otherwise delegates all installation to the Agent SDK.
 */
async function initialize(agentDir: string): Promise<void> {
  try {
    const status = getExtensionInstallationStatus({ agentDir });
    const online = status.missing.length === 0 || (await isExtensionRegistryAvailable());
    const result = online
      ? await ensureExtensionsInstalled({ agentDir })
      : {
          alreadyInstalled: status.installed,
          installed: [],
          failures: status.missing.map((source) => ({
            source,
            error: 'npm registry is unreachable',
            networkUnavailable: true,
          })),
        };
    process.send?.(
      {
        result: {
          ...result,
          failures: result.failures.map((failure) => ({ ...failure, error: String(failure.error) })),
        },
      },
      () => process.exit(0)
    );
  } catch (error) {
    process.send?.({ error: String(error) }, () => process.exit(1));
  }
}
