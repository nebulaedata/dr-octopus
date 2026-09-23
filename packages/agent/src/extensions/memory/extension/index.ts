/**
 * @author Codex
 * @description Compose the built-in memory Pi surfaces with a single shared Service per factory invocation.
 */
import { createMemoryService, resolveMemoryPaths } from '../sdk/index.js';
import { registerMemoryEvents } from './events.js';
import { registerMemoryTools } from './tools.js';
import { registerMemoryCommands } from './commands.js';
import { createMemoryDiagnostics } from './diagnostics.js';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { MemoryScreeningSettingsStore } from '../lib/screening-settings.js';
import { JevSettingsStore } from '../../../lib/jev/settings.js';
import { screenMemoryWithJev } from '../lib/jev-screen.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
/**
 * Construct fresh disposable session resources on every Pi reload or session replacement.
 */
export function createMemoryExtension(
  options: Parameters<typeof createMemoryService>[0] & { agentDir?: string } = {}
) {
  return (pi: ExtensionAPI) => {
    const service = createMemoryService(options);
    const log = createMemoryDiagnostics(resolveMemoryPaths(options.dataRoot).directory);
    const jev = new JevSettingsStore(options.agentDir ?? getAgentDir());
    const screening = new MemoryScreeningSettingsStore(options.dataRoot);
    const budget = registerMemoryEvents(pi, service, options?.readOnly ?? false, log, (sources, signal) =>
      screenMemoryWithJev(jev, screening, sources, signal)
    );
    registerMemoryTools(pi, service, budget);
    registerMemoryCommands(pi, service);
  };
}
export default createMemoryExtension();
