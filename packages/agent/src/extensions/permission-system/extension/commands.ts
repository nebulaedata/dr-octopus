/**
 * @author Codex
 * @description Registers the TUI fallback command for inspecting and changing permission mode.
 */

import { isPermissionMode } from '@octopus/shared/protocol';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PermissionModeService } from '../services/permission-mode-service.js';

/**
 * Registers the permission-mode command against the shared service.
 *
 * @param pi Pi extension registration surface.
 * @param service Shared runtime-generation permission service.
 */
export function registerPermissionCommands(pi: ExtensionAPI, service: PermissionModeService): void {
  pi.registerCommand('permission-mode', {
    description: 'Usage: /permission-mode [ask|auto|full]',
    handler: (args, ctx) => Promise.resolve(handlePermissionCommand(args, ctx, service)),
  });
}

/**
 * Executes the synchronous permission command behavior behind Pi's asynchronous command contract.
 *
 * @param args Raw command arguments.
 * @param ctx Pi command context.
 * @param service Shared runtime-generation permission service.
 */
function handlePermissionCommand(
  args: string,
  ctx: Parameters<Parameters<ExtensionAPI['registerCommand']>[1]['handler']>[1],
  service: PermissionModeService
): void {
  const mode = args.trim();
  if (mode.length === 0) {
    ctx.ui.notify(`Permission mode: ${service.getState().mode}`, 'info');
    return;
  }
  if (!isPermissionMode(mode)) {
    ctx.ui.notify('Usage: /permission-mode [ask|auto|full]', 'error');
    return;
  }
  service.setMode(mode);
  ctx.ui.notify(`Permission mode: ${mode}`, 'info');
}
