/**
 * @author Codex
 * @description Routes finite commands through browser-owned document identities and permission-checked top-frame channels.
 */
import { browser } from 'wxt/browser';
import { captureBrowserImage } from './browser-screenshot';
import { z } from 'zod';
import { pageIdentitySchema } from '@octopus/shared/protocol/browser-tools';
import type { BrowserCommand } from '@octopus/shared/protocol/browser-tools';
export class BrowserRouter {
  private documents = new Map<number, { identity?: z.infer<typeof pageIdentitySchema>; revision: string }>();
  private preparing = new Map<number, Promise<z.infer<typeof pageIdentitySchema>>>();
  private feedback = new Map<number, { documentId: string; connectionId: string; taskId: string }>();
  private revision = 0;
  /**
   * Records identities only from authenticated top-frame sender metadata.
   */
  constructor() {
    browser.runtime.onMessage.addListener((message: unknown, sender) => {
      const parsed = z
        .strictObject({ type: z.literal('page.ready'), controllerId: z.uuid() })
        .safeParse(message);
      if (
        !parsed.success ||
        sender.id !== browser.runtime.id ||
        sender.frameId !== 0 ||
        !sender.tab?.id ||
        !sender.documentId ||
        !sender.url ||
        !/^https?:/.test(sender.url)
      ) {
        return;
      }
      if (this.documents.size >= 32 && !this.documents.has(sender.tab.id)) {
        throw new Error('BROWSER_BUSY');
      }
      const identity = { documentId: sender.documentId, controllerId: parsed.data.controllerId };
      const route = this.documents.get(sender.tab.id) ?? { revision: crypto.randomUUID() };
      route.identity = identity;
      this.documents.set(sender.tab.id, route);
      return Promise.resolve({ documentId: sender.documentId });
    });
    browser.tabs.onRemoved.addListener((id) => {
      this.documents.delete(id);
      this.feedback.delete(id);
    });
    browser.tabs.onReplaced.addListener((addedId, removedId) => {
      this.documents.delete(removedId);
      this.documents.delete(addedId);
      this.feedback.delete(removedId);
      this.feedback.delete(addedId);
    });
    browser.tabs.onUpdated.addListener((id, change) => {
      if (change.url || change.status === 'loading') {
        const route = this.documents.get(id);
        if (route) {
          route.identity = undefined;
          route.revision = crypto.randomUUID();
        }
      }
    });
  }
  /**
   * Clears connection-bound routes on detach; no page action is replayed after reconnect.
   */
  reset() {
    this.revision++;
    void this.release().catch(() => {});
    this.documents.clear();
    this.preparing.clear();
  }
  /**
   * Reclaims matching task routes before awaiting feedback cleanup so late replies cannot delete new routes.
   */
  private async release(taskId?: string, connectionId?: string) {
    await Promise.all(
      [...this.feedback].map(async ([id, owner]) => {
        if ((taskId && owner.taskId !== taskId) || (connectionId && owner.connectionId !== connectionId)) {
          return;
        }
        this.feedback.delete(id);
        this.documents.delete(id);
        await browser.tabs
          .sendMessage(
            id,
            { type: 'page.release', ...owner },
            {
              documentId: owner.documentId,
            }
          )
          .catch(() => {});
      })
    );
    return { released: true };
  }
  /**
   * Rejects unavailable, protected and non-executable targets before probes or actions; replacement never remaps an old handle.
   */
  private async tab(id: number, executable = true) {
    const tab = await browser.tabs.get(id).catch((error: unknown) => {
      throw new Error('TARGET_CHANGED', { cause: error });
    });
    if (executable && (tab.discarded || tab.frozen)) {
      throw new Error('TAB_NOT_EXECUTABLE');
    }
    if (
      tab.incognito ||
      !tab.url ||
      !/^https?:/.test(tab.url) ||
      !(await browser.permissions.contains({ origins: [new URL(tab.url).origin + '/*'] }))
    ) {
      throw new Error('FORBIDDEN_PAGE');
    }
    return tab;
  }
  /**
   * Coalesces preparation and injects once only when a harmless ping reports a missing receiver.
   */
  private ensure(id: number, connectionId: string, taskId?: string) {
    const existing = this.preparing.get(id);
    if (existing) {
      return existing;
    }
    const pending = (async () => {
      await this.tab(id);
      let route = this.documents.get(id);
      if (!route) {
        if (this.documents.size >= 32) {
          throw new Error('BROWSER_BUSY');
        }
        route = { revision: crypto.randomUUID() };
        this.documents.set(id, route);
      }
      const revision = route.revision;
      let identity: unknown;
      try {
        identity = await browser.tabs.sendMessage(
          id,
          { type: 'page.ping', connectionId, documentRevision: revision, taskId },
          { frameId: 0 }
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/Receiving end does not exist|Could not establish connection/.test(error.message)
        ) {
          throw new Error('TARGET_CHANGED', { cause: error });
        }
        await this.tab(id);
        await browser.scripting.executeScript({
          target: { tabId: id, frameIds: [0] },
          files: ['/content-scripts/content.js'],
          world: 'ISOLATED',
        });
        identity = await browser.tabs.sendMessage(
          id,
          { type: 'page.ping', connectionId, documentRevision: revision, taskId },
          { frameId: 0 }
        );
      }
      const parsed = pageIdentitySchema.parse(identity);
      if (
        this.documents.get(id)?.revision !== revision ||
        JSON.stringify(this.documents.get(id)?.identity) !== JSON.stringify(parsed)
      ) {
        throw new Error('TARGET_CHANGED');
      }
      return parsed;
    })();
    this.preparing.set(id, pending);
    void pending
      .finally(() => {
        if (this.preparing.get(id) === pending) {
          this.preparing.delete(id);
        }
      })
      .catch(() => {});
    return pending;
  }
  /**
   * Executes only a finite tab/page method using browser documentId-targeted messaging.
   */
  async execute(command: BrowserCommand): Promise<unknown> {
    if (command.type === 'release') {
      return this.release(command.taskId, command.connectionId);
    }
    const revision = this.revision;
    if (command.method === 'browser_tabs') {
      const tabs = await browser.tabs.query({});
      const result = [];
      for (const tab of tabs) {
        if (tab.id === undefined || tab.incognito || !tab.url || !/^https?:/.test(tab.url)) {
          continue;
        }
        try {
          await this.tab(tab.id, false);
          result.push({ tabId: tab.id, url: tab.url, title: (tab.title ?? '').slice(0, 4096) });
        } catch {
          /* Inaccessible tabs are excluded. */
        }
        if (result.length >= 100) {
          break;
        }
      }
      return { tabs: result };
    }
    if (command.method === 'browser_open_tab') {
      const { url, background } = command.params;
      if (!(await browser.permissions.contains({ origins: [new URL(url).origin + '/*'] }))) {
        throw new Error('FORBIDDEN_PAGE');
      }
      const tab = await browser.tabs.create({ url, active: !background });
      return { tabId: tab.id, url, title: tab.title ?? '' };
    }
    const id = command.params.tabId;
    await this.tab(id, command.method !== 'browser_close_tab' && command.method !== 'browser_navigate');
    if (command.method === 'browser_close_tab') {
      await browser.tabs.remove(id);
      return { businessEffect: 'applied', code: 'TAB_CLOSED' };
    }
    if (command.method === 'browser_navigate') {
      if (!(await browser.permissions.contains({ origins: [new URL(command.params.url).origin + '/*'] }))) {
        throw new Error('FORBIDDEN_PAGE');
      }
      this.documents.delete(id);
      await browser.tabs.update(id, { url: command.params.url });
      try {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const current = await this.tab(id, false);
          if (current.status === 'complete') {
            await this.ensure(id, command.connectionId, command.taskId);
            return { businessEffect: 'applied', code: 'NAVIGATION_COMPLETED' };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        throw new Error('OUTCOME_UNKNOWN', { cause: error });
      }
      throw new Error('OUTCOME_UNKNOWN');
    }
    if (command.method === 'browser_snapshot' && command.params.screenshot) {
      const target = await this.tab(id);
      await browser.tabs.update(id, { active: true });
      const window = await browser.windows.get(target.windowId!);
      if (window.state === 'minimized') {
        await browser.windows.update(target.windowId!, { state: 'normal' });
      }
    }
    const identity = await this.ensure(id, command.connectionId, command.taskId);
    if (revision !== this.revision || !command.taskId) {
      throw new Error('TARGET_CHANGED');
    }
    const expected = 'target' in command.params ? command.params.target : command.params;
    if (
      'documentId' in expected &&
      (expected.documentId !== identity.documentId || expected.controllerId !== identity.controllerId)
    ) {
      throw new Error('TARGET_CHANGED');
    }
    await this.tab(id);
    if (revision !== this.revision) {
      throw new Error('TARGET_CHANGED');
    }
    this.feedback.set(id, {
      documentId: identity.documentId,
      connectionId: command.connectionId,
      taskId: command.taskId,
    });
    const reply = await browser.tabs.sendMessage(id, command, { documentId: identity.documentId });
    if (command.method !== 'browser_snapshot' || !command.params.screenshot || reply?.error) {
      return reply;
    }
    const target = { documentId: identity.documentId };
    const reference = { ...identity, snapshotId: reply.result.snapshotId };
    const prepared = await browser.tabs.sendMessage(
      id,
      { type: 'page.screenshot-begin', ...reference },
      target
    );
    if (prepared?.valid !== true) {
      throw new Error('STALE_SNAPSHOT');
    }
    let image;
    let failure: unknown;
    let restored: { valid?: boolean } | undefined;
    try {
      image = await captureBrowserImage(id, async () => {
        await this.tab(id);
        const result = await browser.tabs.sendMessage(
          id,
          { type: 'page.snapshot-check', ...reference },
          target
        );
        if (result?.valid !== true) {
          throw new Error('STALE_SNAPSHOT');
        }
      });
    } catch (error) {
      failure = error;
    } finally {
      restored = await browser.tabs
        .sendMessage(id, { type: 'page.screenshot-end', ...reference }, target)
        .catch((error: unknown) => {
          failure ??= error;
          return undefined;
        });
    }
    if (failure) {
      throw failure;
    }
    if (restored?.valid !== true) {
      throw new Error('STALE_SNAPSHOT');
    }
    return { result: { ...reply.result, image } };
  }
}
