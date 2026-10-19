/**
 * @author Codex
 * @description Adapts finite maintenance IPC without exposing filesystem or clipboard capabilities.
 */
import { maintenanceResponseSchema } from '../../../contracts/maintenance';
import type { MaintenanceAction } from '../../../contracts/maintenance';
import { desktopActionResponseSchema } from '../../../contracts/runtime';

/**
 * Reads safe recovery status from Main independently of Runtime availability.
 */
export async function readMaintenance() {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  const reply = maintenanceResponseSchema.parse(await window.executor.readMaintenance());
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}

/**
 * Requests one finite maintenance action with a stale-state guard and no automatic retry.
 */
export async function maintenanceAction(input: MaintenanceAction): Promise<void> {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  const reply = desktopActionResponseSchema.parse(await window.executor.maintenanceAction(input));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
}
