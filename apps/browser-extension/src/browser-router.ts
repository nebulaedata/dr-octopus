/**
 * @author Codex
 * @description Routes finite commands through browser-owned document identities and permission-checked top-frame channels.
 */
import { browser } from 'wxt/browser';
import { PageAccessError } from './page-access';
import {
  pageWaitDefaults,
  pageWaitPolicySchema,
  type PageWaitPolicy,
  type PageWaitObserver,
} from './page-wait-policy';
import { captureBrowserImage } from './browser-screenshot';
import { z } from 'zod';
import { pageIdentitySchema } from '@octopus/shared/protocol/browser-tools';
import type { BrowserCommand } from '@octopus/shared/protocol/browser-tools';
import { localPageRequestSchema, pageOwner, type PageOwner, type LocalPageRequest } from './page-commands';
export class BrowserRouter {
  private documents = new Map<number, { identity?: z.infer<typeof pageIdentitySchema>; revision: string }>();
  private preparing = new Map<number, Promise<z.infer<typeof pageIdentitySchema>>>();
  private feedback = new Map<number, { documentId: string; taskId: string } & PageOwner>();
  private localRun?: { id: string; origins: string[]; windowId?: number; pageWait: PageWaitPolicy };
  private readonly uncertainLocalRuns = new Set<string>();
  private revision = 0;
  private inFlight = 0;
  private admission?: (method: string) => Promise<void>;
  private readonly unknownTargets = new Set<number>();
  /**
   * Wires extension-local capture admission without changing the Native protocol.
   */
  setRecordingAdmission(admission: (method: string) => Promise<void>): void {
    this.admission = admission;
  }
  /**
   * Reports live page ownership and unknown outcomes; recording must not steal these resources.
   */
  busy(): boolean {
    return (
      Boolean(this.localRun) ||
      this.uncertainLocalRuns.size > 0 ||
      this.inFlight > 0 ||
      this.feedback.size > 0 ||
      this.unknownTargets.size > 0
    );
  }
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
      this.unknownTargets.delete(id);
    });
    browser.tabs.onReplaced.addListener((addedId, removedId) => {
      this.unknownTargets.delete(removedId);
      this.documents.delete(removedId);
      this.documents.delete(addedId);
      this.feedback.delete(removedId);
      this.feedback.delete(addedId);
    });
    browser.tabs.onUpdated.addListener((id, change) => {
      if (change.url || change.status === 'loading') {
        this.unknownTargets.delete(id);
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
    if (this.localRun || this.uncertainLocalRuns.size) {
      return;
    }
    this.revision++;
    void this.release().catch(() => {});
    this.documents.clear();
    this.preparing.clear();
  }
  /**
   * Reclaims matching task routes before awaiting feedback cleanup so late replies cannot delete new routes.
   */
  private async release(taskId?: string, connectionId?: string, localRunId?: string) {
    await Promise.all(
      [...this.feedback].map(async ([id, owner]) => {
        if (
          (taskId && owner.taskId !== taskId) ||
          (connectionId && (!('connectionId' in owner) || owner.connectionId !== connectionId)) ||
          (localRunId && (!('localRunId' in owner) || owner.localRunId !== localRunId))
        ) {
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
    if (this.localRun?.windowId !== undefined && tab.windowId !== this.localRun.windowId) {
      throw new PageAccessError('window', id, tab.url);
    }
    if (tab.incognito) {
      throw new PageAccessError('private', id);
    }
    if (!tab.url || !/^https?:/.test(tab.url)) {
      throw new PageAccessError('scheme', id);
    }
    if (this.localRun && !this.localRun.origins.includes(new URL(tab.url).origin)) {
      throw new PageAccessError('origin', id, tab.url);
    }
    if (!(await this.hasSitePermission(new URL(tab.url).origin))) {
      throw new PageAccessError('permission', id, tab.url);
    }
    return tab;
  }

  /**
   * Rechecks the browser-owned site grant without requesting permission or inspecting page contents.
   */
  async hasSitePermission(origin: string): Promise<boolean> {
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol) || url.origin !== origin) {
      return false;
    }
    return browser.permissions.contains({ origins: [origin + '/*'] });
  }
  /**
   * Coalesces preparation and injects once only when a harmless ping reports a missing receiver.
   */
  private ensure(id: number, owner: PageOwner, taskId?: string, allowInjection = true) {
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
          { type: 'page.ping', ...owner, documentRevision: revision, taskId },
          { frameId: 0 }
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/Receiving end does not exist|Could not establish connection/.test(error.message)
        ) {
          throw new Error('TARGET_CHANGED', { cause: error });
        }
        if (!allowInjection) {
          throw new Error('PAGE_RECEIVER_NOT_READY', { cause: error });
        }
        await this.tab(id);
        await browser.scripting.executeScript({
          target: { tabId: id, frameIds: [0] },
          files: ['/content-scripts/content.js'],
          world: 'ISOLATED',
        });
        identity = await browser.tabs.sendMessage(
          id,
          { type: 'page.ping', ...owner, documentRevision: revision, taskId },
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
    if ((this.localRun || this.uncertainLocalRuns.size) && command.type === 'request') {
      throw new Error('BROWSER_BUSY');
    }
    return this.run(command);
  }
  /**
   * Acquires local page ownership without taking over existing Bridge work or unknown outcomes.
   */
  async claimLocal(
    id: string,
    origins: string[],
    windowId?: number,
    pageWait = pageWaitDefaults
  ): Promise<void> {
    z.uuid().parse(id);
    const policy = pageWaitPolicySchema.parse(pageWait);
    if (this.localRun?.id === id) {
      if (this.localRun.windowId === windowId) {
        return;
      }
      // An explicit resume may move windows only after all old page effects have settled.
      await this.releaseLocal(id);
    }
    await this.admission?.('browser_snapshot');
    if (this.localRun || this.busy()) {
      throw new Error('BROWSER_BUSY');
    }
    this.localRun = { id, origins: [...origins], windowId, pageWait: policy };
  }
  /**
   * Uses the same finite router after checking the currently owned local run.
   */
  async executeLocal(raw: unknown, onWait?: PageWaitObserver): Promise<unknown> {
    const command = localPageRequestSchema.parse(raw);
    if (this.localRun?.id !== command.localRunId || command.taskId !== command.localRunId) {
      throw new Error('TARGET_CHANGED');
    }
    return this.run(command, onWait);
  }
  /**
   * Releases only a settled local task; uncertain actions continue blocking resource takeover.
   */
  async releaseLocal(id: string): Promise<void> {
    if (this.localRun?.id !== id) {
      return;
    }
    if (this.inFlight || this.unknownTargets.size || this.uncertainLocalRuns.has(id)) {
      throw new Error('BROWSER_BUSY');
    }
    await this.release(id, undefined, id);
    if (this.localRun?.id === id) {
      this.localRun = undefined;
    }
  }
  /**
   * Restores a fail-closed reservation from the durable task before another execution owner can enter.
   */
  restoreUncertainLocal(id: string): void {
    this.uncertainLocalRuns.add(z.uuid().parse(id));
  }

  /**
   * Releases only after an explicit user acknowledgement and an idle response from each surviving owned document.
   */
  async acknowledgeLocal(
    id: string,
    documents: { tabId: number; documentId: string }[],
    commit: () => Promise<void>
  ): Promise<void> {
    if (this.inFlight) {
      throw new Error('BROWSER_BUSY');
    }
    for (const document of documents) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          browser.tabs
            .sendMessage(
              document.tabId,
              { type: 'page.release-if-idle', localRunId: id, taskId: id },
              { documentId: document.documentId }
            )
            .catch((error: unknown) => {
              if (
                error instanceof Error &&
                /No tab with id|No document with id|Receiving end does not exist/.test(error.message)
              ) {
                return { released: true };
              }
              throw new Error('BROWSER_BUSY');
            }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('BROWSER_BUSY')), 3000);
          }),
        ]);
        if (result?.released !== true) {
          throw new Error('BROWSER_BUSY');
        }
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }
    await commit();
    this.uncertainLocalRuns.delete(id);
    if (this.localRun?.id === id) {
      this.unknownTargets.clear();
      await this.releaseLocal(id);
    }
  }
  /**
   * Applies shared recording admission and preserves unknown outcomes for either execution owner.
   */
  private async run(command: BrowserCommand | LocalPageRequest, onWait?: PageWaitObserver): Promise<unknown> {
    this.inFlight++;
    try {
      if (command.type === 'request') {
        await this.admission?.(command.method);
        if (!('localRunId' in command) && (this.localRun || this.uncertainLocalRuns.size)) {
          throw new Error('BROWSER_BUSY');
        }
      }
      const result = await this.executeCommand(command, onWait);
      if (
        command.type === 'request' &&
        'tabId' in command.params &&
        result &&
        typeof result === 'object' &&
        'error' in result &&
        result.error === 'OUTCOME_UNKNOWN'
      ) {
        this.unknownTargets.add(command.params.tabId);
      }
      return result;
    } catch (error) {
      if (
        command.type === 'request' &&
        'tabId' in command.params &&
        error instanceof Error &&
        error.message === 'OUTCOME_UNKNOWN'
      ) {
        this.unknownTargets.add(command.params.tabId);
      }
      throw error;
    } finally {
      this.inFlight--;
    }
  }
  /**
   * Waits for the committed main document and its static document-end receiver, not unrelated subresource completion.
   */
  private async waitForDocument(id: number, owner: PageOwner, taskId?: string, onWait?: PageWaitObserver) {
    const policy =
      'localRunId' in owner ? (this.localRun?.pageWait ?? pageWaitDefaults) : { seconds: 10, attempts: 1 };
    for (let attempt = 0; attempt < policy.attempts; attempt++) {
      const startedAt = Date.now();
      const deadline = startedAt + policy.seconds * 1000;
      await onWait?.({ ...policy, attempt: attempt + 1, tabId: id, startedAt });
      while (Date.now() < deadline) {
        const tab = await browser.tabs.get(id).catch((error: unknown) => {
          throw new Error('TARGET_CHANGED', { cause: error });
        });
        if (tab.url && /^https?:/.test(tab.url) && (!tab.pendingUrl || tab.pendingUrl === tab.url)) {
          try {
            const admitted = await this.tab(id);
            const identity = await this.ensure(id, owner, taskId, false);
            const checked = await this.tab(id);
            if (
              checked.url === admitted.url &&
              (!checked.pendingUrl || checked.pendingUrl === checked.url) &&
              this.documents.get(id)?.identity?.documentId === identity.documentId
            ) {
              return checked;
            }
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !['TARGET_CHANGED', 'PAGE_RECEIVER_NOT_READY'].includes(error.message)
            ) {
              throw error;
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error('PAGE_READY_TIMEOUT', {
      cause: { waitSeconds: policy.seconds, timeouts: policy.attempts },
    });
  }

  /**
   * Preserves a known tab mutation receipt with a bounded, JSON-safe observation failure instead of claiming the mutation is unknown.
   */
  private readinessFailure(error: unknown) {
    const wait = z
      .object({ waitSeconds: z.number().int().min(1).max(60), timeouts: z.number().int().min(1).max(5) })
      .safeParse(error instanceof Error ? error.cause : undefined);
    const code =
      error instanceof Error &&
      ['PAGE_READY_TIMEOUT', 'TARGET_CHANGED', 'FORBIDDEN_PAGE', 'TAB_NOT_EXECUTABLE'].includes(error.message)
        ? error.message
        : 'PAGE_RECEIVER_NOT_READY';
    return {
      status: 'not_ready',
      code,
      ...(code === 'PAGE_READY_TIMEOUT' && wait.success ? { wait: wait.data } : {}),
      ...(error instanceof PageAccessError ? { access: error.access } : {}),
      next: 'Use the returned tabId. Observe it again or ask the user; do not repeat the completed open/navigation operation.',
    };
  }

  /**
   * Dispatches an admitted finite command using the existing document-bound route.
   */
  private async executeCommand(
    command: BrowserCommand | LocalPageRequest,
    onWait?: PageWaitObserver
  ): Promise<unknown> {
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
      if (this.localRun && !this.localRun.origins.includes(new URL(url).origin)) {
        throw new PageAccessError('origin', undefined, url);
      }
      if (!(await browser.permissions.contains({ origins: [new URL(url).origin + '/*'] }))) {
        throw new PageAccessError('permission', undefined, url);
      }
      const tab = await browser.tabs.create({
        url,
        active: !background,
        ...(this.localRun?.windowId !== undefined ? { windowId: this.localRun.windowId } : {}),
      });
      if (tab.id === undefined) {
        throw new Error('OUTCOME_UNKNOWN');
      }
      try {
        const ready = await this.waitForDocument(tab.id, pageOwner(command), command.taskId, onWait);
        return { tabId: tab.id, url: ready.url, title: ready.title ?? '' };
      } catch (error) {
        return {
          tabId: tab.id,
          url,
          title: '',
          businessEffect: 'applied',
          code: 'TAB_OPENED',
          readiness: this.readinessFailure(error),
        };
      }
    }
    const id = command.params.tabId;
    await this.tab(id, command.method !== 'browser_close_tab' && command.method !== 'browser_navigate');
    if (command.method === 'browser_close_tab') {
      await browser.tabs.remove(id);
      return { businessEffect: 'applied', code: 'TAB_CLOSED' };
    }
    if (command.method === 'browser_navigate') {
      if (this.localRun && !this.localRun.origins.includes(new URL(command.params.url).origin)) {
        throw new PageAccessError('origin', id, command.params.url);
      }
      if (!(await browser.permissions.contains({ origins: [new URL(command.params.url).origin + '/*'] }))) {
        throw new PageAccessError('permission', id, command.params.url);
      }
      this.documents.delete(id);
      await browser.tabs.update(id, { url: command.params.url });
      try {
        await this.waitForDocument(id, pageOwner(command), command.taskId, onWait);
        return { businessEffect: 'applied', code: 'NAVIGATION_COMPLETED' };
      } catch (error) {
        return {
          tabId: id,
          businessEffect: 'applied',
          code: 'NAVIGATION_STARTED',
          readiness: this.readinessFailure(error),
        };
      }
    }
    if (command.method === 'browser_snapshot' && (command.params.screenshot || 'localRunId' in command)) {
      const target = await this.tab(id);
      await browser.tabs.update(id, { active: true });
      const window = await browser.windows.get(target.windowId!);
      if (window.state === 'minimized') {
        await browser.windows.update(target.windowId!, { state: 'normal' });
      }
      if ('localRunId' in command) {
        await browser.windows.update(target.windowId!, { focused: true });
      }
    }
    const identity = await this.ensure(id, pageOwner(command), command.taskId);
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
      ...pageOwner(command),
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
