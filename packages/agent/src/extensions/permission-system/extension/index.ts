/**
 * @author Codex
 * @description Composes the built-in Octopus permission command and execution gates.
 */

import { createPermissionModeService } from '../sdk/index.js';
import { registerPermissionCommands } from './commands.js';
import { registerUnattendedExecution } from './unattended.js';
import { registerPermissionEvents } from './events.js';
import { registerPermissionTools } from './tools.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PermissionModeService } from '../services/permission-mode-service.js';

/**
 * Creates a Pi inline extension backed by the provided permission service.
 *
 * @param service Optional shared service; otherwise each factory call creates its own instance.
 * @returns Pi extension factory.
 */
export function createPermissionSystemExtension(
  service: PermissionModeService = createPermissionModeService()
) {
  return function permissionSystemExtension(pi: ExtensionAPI): void {
    const unattended = registerUnattendedExecution(pi, service);
    if (!unattended) {
      registerPermissionCommands(pi, service);
    }
    registerPermissionTools(pi, service);
    registerPermissionEvents(pi, service, unattended);
  };
}

export default createPermissionSystemExtension();
