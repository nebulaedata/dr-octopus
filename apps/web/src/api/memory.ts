/**
 * @author Codex
 * @description Browser-safe global memory administration, independent of Workspace and Agent runtime.
 */
import { request } from '@/utils/request';
import { t } from '@/i18n/translate';
import type {
  MemoryScreeningSnapshot,
  MemoryScreeningUpdate,
  MemoryStatus,
  MemoryPage,
  MemoryReadResult,
  MemoryRef,
  MemoryDocument,
  MemoryRemember,
  MemoryForget,
  MemoryPolicy,
  MemoryReceipt,
  MemoryServiceStatus,
} from '@octopus/shared/protocol/memory';
/**
 * Observe or explicitly manage the global memory background service.
 */
export function memoryService(
  action: 'status' | 'start' | 'stop' | 'restart',
  signal?: AbortSignal
): Promise<MemoryServiceStatus> {
  return request({
    url: `/memory/service/${action}`,
    method: action === 'status' ? 'GET' : 'POST',
    signal,
    timeout: 65_000,
  });
}
/**
 * Observe global storage and policy without creating a database.
 */
export function getMemoryStatus(signal?: AbortSignal): Promise<MemoryStatus> {
  return request({ url: '/memory/status', signal });
}
/**
 * List a revision-bound directory page or FTS candidates.
 */
export function getMemoryIndexes(query: string, cursor?: string, signal?: AbortSignal): Promise<MemoryPage> {
  return request({ url: '/memory/indexes', params: query ? { query } : { cursor }, signal });
}
/**
 * Assemble a complete fact for editing; an interrupted/stale read never yields a partial editable document.
 */
export async function getMemoryDocument(ref: MemoryRef, signal?: AbortSignal): Promise<MemoryDocument> {
  let continuation: string | undefined;
  let document: MemoryDocument | undefined;
  for (let i = 0; i < 16; i++) {
    const part: MemoryReadResult = await request({
      url: '/memory/read',
      method: 'POST',
      data: { refs: [ref], continuation },
      signal,
    });
    const item = part.items[0];
    if (!item?.document) {
      throw new Error(
        t('api.memory.deletedOrSuperseded', 'The memory was deleted or superseded; refresh the directory.')
      );
    }
    document = document ? { ...document, bodyMd: document.bodyMd + item.document.bodyMd } : item.document;
    if (part.complete) {
      return document;
    }
    continuation = part.continuation;
    if (!continuation) {
      break;
    }
  }
  throw new Error(t('api.memory.contentIncomplete', 'The content was not fully read; reopen the memory.'));
}
/**
 * Persist only explicit form submissions and return the committed receipt.
 */
export function rememberMemory(data: MemoryRemember): Promise<MemoryReceipt> {
  return request({ url: '/memory/remember', method: 'POST', data });
}
/**
 * Forget the exact revision currently reviewed by the user.
 */
export function forgetMemory(data: MemoryForget): Promise<MemoryReceipt> {
  return request({ url: '/memory/forget', method: 'POST', data });
}
/**
 * Set one policy shared by every Workspace and Session.
 */
export function setMemoryPolicy(data: MemoryPolicy): Promise<MemoryReceipt> {
  return request({ url: '/memory/policy', method: 'POST', data });
}

/**
 * Read optional automatic-memory screening independently of daemon availability.
 */
export function getMemoryScreening(signal?: AbortSignal): Promise<MemoryScreeningSnapshot> {
  return request({ url: '/memory/screening', signal });
}
/**
 * Persist memory-owned screening settings without changing Jev connection configuration.
 */
export function saveMemoryScreening(data: MemoryScreeningUpdate): Promise<MemoryScreeningSnapshot> {
  return request({ url: '/memory/screening', method: 'PUT', data });
}
