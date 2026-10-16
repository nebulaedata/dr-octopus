/**
 * @author Codex
 * @description Adapts named Preload connection settings with checked safe replies.
 */
import { settingsResponseSchema, type SettingsInput } from '../../../contracts/connection-settings';

/**
 * Reads settings without depending on external network connectivity.
 */
export async function readConnectionSettings() {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  const reply = settingsResponseSchema.parse(await window.executor.readSettings());
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}

/**
 * Saves next-start listener choices without restarting or cancelling a task.
 */
export async function saveConnectionSettings(input: SettingsInput) {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  const reply = settingsResponseSchema.parse(await window.executor.saveSettings(input));
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}
