/**
 * @author Codex
 * @description Composes background process Pi surfaces around a fresh per-load service.
 */
import { createBackgroundTaskService } from '../sdk/index.js';
import { registerBackgroundCommands } from './commands.js';
import { registerBackgroundEvents } from './events.js';
import { registerBackgroundTools } from './tools.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Creates fresh state on every Pi load/reload, never sharing task IDs between sessions.
 */
export function createBackgroundTaskExtension() {
  return (pi: ExtensionAPI): void => {
    const service = createBackgroundTaskService();
    registerBackgroundCommands(pi, service);
    registerBackgroundEvents(pi, service);
    registerBackgroundTools(pi, service);
  };
}

export default createBackgroundTaskExtension();
