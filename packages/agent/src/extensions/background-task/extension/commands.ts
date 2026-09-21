/**
 * @author Codex
 * @description Provides a model-independent control plane with snapshot-based completion evidence.
 */
import { BACKGROUND_COMMAND, isBackgroundTaskActive } from '@octopus/shared/protocol';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { BackgroundTaskManager } from '../services/task-manager.js';

/**
 * Control commands never start processes and remain usable while the model is running.
 */
export function registerBackgroundCommands(pi: ExtensionAPI, service: BackgroundTaskManager): void {
  pi.registerCommand(BACKGROUND_COMMAND, {
    description:
      'Managed processes: status | begin <stopId> | finish <stopId> | stop <taskId> | logs <taskId>',
    async handler(args, ctx) {
      try {
        const [action, id, extra] = args.trim().split(/\s+/);
        if (
          extra ||
          (action === 'status' && id !== undefined) ||
          (action !== 'status' && (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)))
        ) {
          throw new Error('INVALID_ARGUMENT');
        }
        switch (action) {
          case 'status':
            service.publish();
            break;
          case 'begin':
            service.beginStop(id!);
            break;
          case 'finish':
            service.finishStop(id!);
            break;
          case 'stop':
            service.stop(id!);
            if (isBackgroundTaskActive(await service.wait(id!, 10000))) {
              throw new Error('STOP_TIMEOUT');
            }
            break;
          case 'logs':
            service.showLogs(id!);
            if (ctx.hasUI && ctx.mode !== 'rpc') {
              ctx.ui.notify(service.readLogs(id!).text || 'No output yet.', 'info');
            }
            break;
          default:
            throw new Error('INVALID_ARGUMENT');
        }
        service.clearError();
      } catch (error) {
        service.reportError();
        throw error;
      }
    },
  });
}
