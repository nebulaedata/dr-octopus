/**
 * @author Codex
 * @description Composes thin Pi surfaces over the Agent-owned Scheduler client.
 */
import { createSchedulerClient } from '../sdk/client.js';
import { registerSchedulerTools } from './tools.js';
import { registerSchedulerCommands } from './commands.js';
import { registerSchedulerEvents } from './events.js';
import { registerSchedulerRenderers } from './renderers.js';
import type { SchedulerClientOptions } from '../sdk/client.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SchedulerControlClient } from '../definitions/port.js';

/**
 * Creates a fresh client per extension instance; shutdown prevents reuse after Session replacement.
 * @param options Workspace-bound client configuration; omission leaves the extension inactive.
 * @param clientFactory Optional client constructor for isolated adapters and tests.
 * @returns Pi extension factory owning client creation and shutdown.
 */
export function createSchedulerExtension(
  options?: SchedulerClientOptions,
  clientFactory: (options: SchedulerClientOptions) => SchedulerControlClient = createSchedulerClient
) {
  return (pi: ExtensionAPI): void => {
    if (!options) {
      return;
    }
    const client = clientFactory(options);
    registerSchedulerTools(pi, client);
    registerSchedulerCommands(pi, client);
    registerSchedulerRenderers(pi);
    registerSchedulerEvents(pi, client);
    pi.on('session_shutdown', () => client.close());
  };
}
export default createSchedulerExtension();
