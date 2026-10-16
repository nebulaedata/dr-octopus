/**
 * @author Codex
 * @description Binds Browser tools to task-owned connections, created tabs and opaque source snapshot cursors.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  browserParams,
  snapshotTargetSchema,
  browserActionSchema,
  browserTabSchema,
  snapshotPageSchema,
} from '@octopus/shared/protocol/browser-tools';
import type { BrowserMethod } from '@octopus/shared/protocol/browser-tools';
import { BasicToolError } from '../basic/basic-inputs';
import type { BrowserBridge } from './browser-bridge';
const task = { taskId: z.uuid(), connectionId: z.uuid().optional() };
const key = { idempotencyKey: z.string().min(1).max(128) };
export const browserSchemas = {
  browser_list: z.strictObject({}),
  browser_tabs: browserParams.browser_tabs.extend({ connectionId: z.uuid().optional() }),
  browser_open_tab: browserParams.browser_open_tab.extend({ ...task, ...key }),
  browser_navigate: browserParams.browser_navigate.extend({ ...task, ...key }),
  browser_close_tab: browserParams.browser_close_tab.extend({ ...task, ...key }),
  browser_snapshot: browserParams.browser_snapshot.extend(task),
  browser_read_snapshot: z.strictObject({ ...task, cursor: z.uuid() }),
  browser_click: browserParams.browser_click.extend({ ...task, ...key }),
  browser_fill: browserParams.browser_fill.extend({ ...task, ...key }),
  browser_select: browserParams.browser_select.extend({ ...task, ...key }),
  browser_scroll: browserParams.browser_scroll.extend({ ...task, ...key }),
};
export type BrowserName = keyof typeof browserSchemas;
type Snapshot = {
  owner: string;
  taskId: string;
  connectionId: string;
  tabId: number;
  page: ReturnType<typeof snapshotPageSchema.parse>;
};
export class BrowserTools {
  private snapshots = new Map<string, Snapshot>();
  private cursors = new Map<string, { snapshotId: string; page: number }>();
  private tabs = new Map<string, Set<string>>();
  private feedback = new Map<string, string>();
  /**
   * Uses the existing bridge authority; never starts a second Runtime or an agent.
   */
  constructor(private readonly bridge: BrowserBridge) {}
  /**
   * Returns live tool capability separately from an installation's connection history.
   */
  available() {
    return (
      this.bridge.snapshot().enabled &&
      this.bridge.snapshot().connections.some((item) => item.state === 'connected' && item.toolsAvailable)
    );
  }
  /**
   * Requires an explicit candidate when multiple installation instances are live.
   */
  select(id?: string) {
    const candidates = this.bridge
      .snapshot()
      .connections.filter((item) => item.state === 'connected' && item.toolsAvailable);
    if (!id && candidates.length > 1) {
      throw new BasicToolError('BROWSER_SELECTION_REQUIRED', 'Specify a connectionId from browser_list.');
    }
    const selected = id ? candidates.find((item) => item.connectionId === id) : candidates[0];
    if (!selected || !this.bridge.snapshot().enabled) {
      throw new BasicToolError('BROWSER_OFFLINE', 'No selected browser connection is available.');
    }
    return selected.connectionId;
  }
  /**
   * Drops executable snapshot references on task transitions while allowing already dispatched calls to finish.
   */
  invalidate(taskId: string) {
    for (const [id, item] of this.snapshots) {
      if (item.taskId === taskId) {
        this.snapshots.delete(id);
      }
    }
    for (const [id, item] of this.cursors) {
      if (!this.snapshots.has(item.snapshotId)) {
        this.cursors.delete(id);
      }
    }
  }
  /**
   * Releases task metadata without closing user tabs or claiming strong page cancellation.
   */
  async release(taskId: string) {
    this.invalidate(taskId);
    this.tabs.delete(taskId);
    const connectionId = this.feedback.get(taskId);
    this.feedback.delete(taskId);
    if (connectionId) {
      // Offline pages are cleaned by the extension's disconnect lifecycle.
      await this.bridge.release(connectionId, taskId).catch(() => {});
    }
  }
  /**
   * Projects authorized connection summaries and permission-filtered tabs without task execution.
   */
  async discover(name: 'browser_list' | 'browser_tabs', input: unknown) {
    if (name === 'browser_list') {
      browserSchemas.browser_list.parse(input);
      return this.bridge.snapshot();
    }
    const parsed = browserSchemas.browser_tabs.parse(input);
    return z
      .strictObject({ tabs: z.array(browserTabSchema).max(100) })
      .parse(await this.bridge.call(this.select(parsed.connectionId), 'browser_tabs', {}));
  }
  /**
   * Executes one task-bound tool and validates finite backend output before returning it to MCP.
   */
  async call(owner: string, taskId: string, name: BrowserName, input: unknown): Promise<unknown> {
    if (name === 'browser_list' || name === 'browser_tabs') {
      return this.discover(name, input);
    }
    const parsed = browserSchemas[name].parse(input);
    if (parsed.taskId !== taskId) {
      throw new BasicToolError('FORBIDDEN', 'The Browser task identity does not match.');
    }
    const connectionId = this.select(parsed.connectionId);
    for (const [id, item] of this.snapshots) {
      if (item.page.expiresAt <= Date.now()) {
        this.snapshots.delete(id);
      }
    }
    for (const [id, item] of this.cursors) {
      if (!this.snapshots.has(item.snapshotId)) {
        this.cursors.delete(id);
      }
    }
    if (name === 'browser_read_snapshot') {
      const read = browserSchemas.browser_read_snapshot.parse(input);
      const cursor = this.cursors.get(read.cursor);
      const cache = cursor && this.snapshots.get(cursor.snapshotId);
      if (!cache || cache.owner !== owner || cache.taskId !== taskId || cache.connectionId !== connectionId) {
        throw new BasicToolError(
          'SNAPSHOT_EXPIRED',
          'The cursor is unavailable for this task and connection.'
        );
      }
      const page = snapshotPageSchema.parse(
        await this.bridge.call(
          connectionId,
          name,
          {
            tabId: cache.tabId,
            documentId: cache.page.documentId,
            controllerId: cache.page.controllerId,
            snapshotId: cache.page.snapshotId,
            page: cursor!.page,
          },
          taskId
        )
      );
      if (
        page.snapshotId !== cache.page.snapshotId ||
        page.documentId !== cache.page.documentId ||
        page.controllerId !== cache.page.controllerId ||
        page.digest !== cache.page.digest ||
        page.page !== cursor!.page ||
        page.pages !== cache.page.pages ||
        page.totalBytes !== cache.page.totalBytes
      ) {
        throw new BasicToolError('TARGET_CHANGED', 'Snapshot page identity changed.');
      }
      return this.output(cache, page);
    }
    const params = browserParams[name as BrowserMethod].parse(
      Object.fromEntries(
        Object.entries(parsed).filter(([key]) => !['taskId', 'connectionId', 'idempotencyKey'].includes(key))
      )
    );
    if (
      name === 'browser_close_tab' &&
      'tabId' in params &&
      !this.tabs.get(taskId)?.has(connectionId + ':' + params.tabId)
    ) {
      throw new BasicToolError('FORBIDDEN', 'Only tabs created by this task may be closed.');
    }
    if (['browser_click', 'browser_fill', 'browser_select', 'browser_scroll'].includes(name)) {
      const action = z.object({ tabId: z.number(), target: snapshotTargetSchema }).parse(parsed);
      const cache = this.snapshots.get(action.target.snapshotId);
      if (
        !cache ||
        cache.owner !== owner ||
        cache.taskId !== taskId ||
        cache.connectionId !== connectionId ||
        cache.tabId !== action.tabId
      ) {
        throw new BasicToolError('SNAPSHOT_EXPIRED', 'Obtain a fresh task-owned snapshot.');
      }
    }
    if (name === 'browser_open_tab' && (this.tabs.get(taskId)?.size ?? 0) >= 100) {
      throw new BasicToolError('BROWSER_BUSY', 'Task tab limit reached.');
    }
    this.feedback.set(taskId, connectionId);
    const value = await this.bridge.call(connectionId, name as BrowserMethod, params, taskId);
    if (name === 'browser_snapshot' && 'tabId' in params) {
      const page = snapshotPageSchema.parse(value);
      if (page.page !== 0 || page.expiresAt <= Date.now() || page.expiresAt > Date.now() + 65000) {
        throw new BasicToolError('INVALID_MESSAGE', 'Invalid snapshot lifetime or first page.');
      }
      for (const [id, item] of this.snapshots) {
        if (item.connectionId === connectionId && item.tabId === params.tabId) {
          this.snapshots.delete(id);
        }
      }
      if (this.snapshots.size >= 32) {
        throw new BasicToolError('SNAPSHOT_LIMIT', 'Active snapshot capacity reached.');
      }
      const cache = { owner, taskId, connectionId, tabId: params.tabId, page };
      this.snapshots.set(page.snapshotId, cache);
      return this.output(cache, page);
    }
    this.invalidate(taskId);
    if (name === 'browser_open_tab') {
      const decoded = browserTabSchema.safeParse(value);
      if (!decoded.success) {
        throw new BasicToolError(
          'OUTCOME_UNKNOWN',
          'The created tab response could not be validated; do not replay.'
        );
      }
      const tab = decoded.data;
      const owned = this.tabs.get(taskId) ?? new Set<string>();
      owned.add(connectionId + ':' + tab.tabId);
      this.tabs.set(taskId, owned);
      return tab;
    }
    const decoded = browserActionSchema.safeParse(value);
    if (!decoded.success) {
      throw new BasicToolError(
        'OUTCOME_UNKNOWN',
        'The dispatched action response could not be validated; do not replay.'
      );
    }
    return decoded.data;
  }
  /**
   * Issues bounded opaque continuation references; page text is never accumulated into a full Runtime snapshot.
   */
  private output(cache: Snapshot, page: Snapshot['page']) {
    if (Buffer.byteLength(page.text) > 65536) {
      throw new BasicToolError('PAYLOAD_TOO_LARGE', 'Snapshot page exceeds the text budget.');
    }
    let nextCursor: string | null = null;
    if (page.page + 1 < page.pages) {
      const existing = [...this.cursors].find(
        ([, item]) => item.snapshotId === cache.page.snapshotId && item.page === page.page + 1
      )?.[0];
      if (!existing && this.cursors.size >= 128) {
        throw new BasicToolError('SNAPSHOT_LIMIT', 'Snapshot cursor capacity reached.');
      }
      nextCursor = existing ?? randomUUID();
      this.cursors.set(nextCursor, { snapshotId: cache.page.snapshotId, page: page.page + 1 });
    }
    return {
      ...page,
      connectionId: cache.connectionId,
      tabId: cache.tabId,
      truncated: false,
      hasMore: nextCursor !== null,
      nextCursor,
    };
  }
}
