/**
 * @author Codex
 * @description Adapts named Preload connection settings with checked safe replies.
 */
import {
  networkAddressesResponseSchema,
  settingsResponseSchema,
  type SettingsInput,
} from '../../../contracts/connection-settings';

/**
 * Lists eligible local IPv4 addresses through the trusted Main without network requests.
 */
export async function readNetworkAddresses() {
  if (!window.executor) {
    throw new Error('请从执行器应用打开此界面');
  }
  const reply = networkAddressesResponseSchema.parse(await window.executor.readNetworkAddresses());
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.data;
}

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
