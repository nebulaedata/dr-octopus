/**
 * @author Codex
 * @description Composes the session manager with the local process ownership adapter.
 */
import { BackgroundTaskManager } from '../services/task-manager.js';
import { createProcessLauncher } from '../lib/process.js';

/**
 * Constructs an isolated manager with no eager processes or timers.
 */
export function createBackgroundTaskService(): BackgroundTaskManager {
  return new BackgroundTaskManager(createProcessLauncher());
}
