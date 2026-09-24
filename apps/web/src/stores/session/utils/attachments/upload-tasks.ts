/**
 * @author root
 * @description Tracks browser-owned tus tasks so Composer removal can cancel network and Server staging work.
 */

import type { AttachmentUploadTask } from '@/api/attachments';

const tasks = new Map<string, AttachmentUploadTask>();

/**
 * Registers one local Composer task until it settles or is explicitly removed.
 */
export function registerAttachmentUploadTask(localKey: string, task: AttachmentUploadTask): void {
  tasks.set(localKey, task);
}

/**
 * Removes a settled browser task without affecting the durable attachment resource.
 */
export function unregisterAttachmentUploadTask(localKey: string): void {
  tasks.delete(localKey);
}

/**
 * Aborts and forgets an active tus task, returning whether a task was present.
 */
export async function abortAttachmentUploadTask(localKey: string): Promise<boolean> {
  const task = tasks.get(localKey);
  if (task === undefined) {
    return false;
  }
  tasks.delete(localKey);
  await task.abort();
  return true;
}
