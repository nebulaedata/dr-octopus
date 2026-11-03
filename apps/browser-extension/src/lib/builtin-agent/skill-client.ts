/**
 * @author Codex
 * @description Sends finite Popup skill commands to the authenticated Worker and reports domain failures without automatic retries.
 */
import { browser } from 'wxt/browser';
import type { SkillCommand } from './skill-messages';

/**
 * Resolves one Worker response; callers own navigation, pending UI and explicit retries.
 */
export async function skillRequest<T>(command: SkillCommand): Promise<T> {
  const reply = await browser.runtime.sendMessage(command);
  if (!reply?.ok) {
    throw new Error(typeof reply?.error === 'string' ? reply.error : 'SKILL_STORAGE');
  }
  return reply.value as T;
}
