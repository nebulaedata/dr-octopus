/**
 * @author Codex
 * @description Coordinates one durable recording independently of Native Messaging and admits only owned page facts.
 */
import { browser } from 'wxt/browser';
import { normalizeRecordingEvents } from './recording-normalizer';
import { RecordingRepository } from './recording-repository';
import {
  isActive,
  recordingLimits,
  recordingRequestSchema,
  type RecordedEvent,
  type RecordingFact,
  type RecordingPage,
  type RecordingRequest,
  type RecordingSession,
  type RecordingView,
} from './recording-contract';
import { safeRecordingText, safeRecordingUrl } from './recording-privacy';

type Sender = {
  id?: string;
  url?: string;
  frameId?: number;
  documentId?: string;
  tab?: { id?: number; windowId?: number; incognito?: boolean };
};

export class RecordingService {
  private active: RecordingSession | null = null;
  private initialized?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private draining = false;
  private failure: string | null = null;

  /**
   * Receives the existing router's actual ownership predicate; storage stays extension-local.
   */
  constructor(
    private readonly bridgeBusy: () => boolean,
    private readonly repository = new RecordingRepository()
  ) {}

  /**
   * Serializes short state/DB mutations only; page flush waits must stay outside this queue.
   */
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Restores only same-browser-session ownership; stale persisted sessions become interrupted evidence.
   */
  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      const marker = await browser.storage.session.get('recordingSessionId');
      const sessions = await this.repository.list();
      for (const session of sessions.filter(isActive)) {
        if (marker.recordingSessionId === session.id && session.status !== 'stopping') {
          this.active = session;
        } else {
          session.status = 'interrupted';
          session.resumedAt = null;
          session.updatedAt = Date.now();
          session.gaps = [...new Set([...session.gaps, '录制运行环境已退出，未确认的尾部操作可能缺失。'])];
          await this.repository.save(session);
        }
      }
      await this.repository.prune(Date.now());
    })();
    return this.initialized;
  }

  /**
   * Prevents automation that could change pages, masks or focus while a recording owns its scope.
   */
  async admitBridge(method: string): Promise<void> {
    if (method === 'browser_tabs') {
      return;
    }
    await this.initialize();
    if (this.active || this.failure) {
      throw new Error('BROWSER_BUSY');
    }
  }

  /**
   * Handles only this extension's recorder namespace; unrelated runtime listeners remain untouched.
   */
  receive(message: unknown, sender: Sender): Promise<unknown> | undefined {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      typeof message.type !== 'string' ||
      !message.type.startsWith('recorder.')
    ) {
      return;
    }
    if (sender.id !== browser.runtime.id) {
      return;
    }
    const parsed = recordingRequestSchema.safeParse(message);
    if (!parsed.success) {
      return Promise.resolve({ ok: false, error: 'RECORDING_FORBIDDEN' });
    }
    const popup = sender.url === browser.runtime.getURL('/popup.html') && !sender.tab;
    // An owned extension tab may display the popup during isolated UI tests or deliberate management.
    const manager =
      popup || (sender.url === browser.runtime.getURL('/popup.html') && sender.tab?.id !== undefined);
    const page =
      sender.frameId === 0 &&
      sender.tab?.id !== undefined &&
      !!sender.documentId &&
      !sender.tab.incognito &&
      !!safeRecordingUrl(sender.url ?? '');
    const request = parsed.data;
    const pageCommand = [
      'recorder.hello',
      'recorder.depart',
      'recorder.batch',
      'recorder.gap',
      'recorder.control',
    ].includes(request.type);
    if (!manager && (!page || !pageCommand)) {
      return Promise.resolve({ ok: false, error: 'RECORDING_FORBIDDEN' });
    }
    return this.dispatch(request, manager ? undefined : sender).then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error: this.error(error) })
    );
  }

  /**
   * Keeps failure diagnostics finite and prevents storage failure from looking like a successful capture.
   */
  private error(error: unknown): string {
    const code = error instanceof Error ? error.message : 'RECORDING_STORAGE';
    if (code === 'RECORDING_STORAGE') {
      this.failure = code;
      if (this.active) {
        this.pauseClock(this.active);
        this.active.status = 'paused';
        this.gap(this.active, '本地存储失败，未确认的操作可能缺失。');
        this.notify();
      }
    }
    return /^[A-Z_]+$/.test(code) ? code : 'RECORDING_STORAGE';
  }

  /**
   * Resolves an ordinary, permission-checked HTTP page without activating it.
   */
  private async target(id: number) {
    const tab = await browser.tabs.get(id);
    if (
      tab.incognito ||
      tab.frozen ||
      tab.discarded ||
      !tab.url ||
      !/^https?:/.test(tab.url) ||
      !(await browser.permissions.contains({ origins: [new URL(tab.url).origin + '/*'] }))
    ) {
      throw new Error('FORBIDDEN_PAGE');
    }
    return {
      tabId: id,
      windowId: tab.windowId,
      origin: new URL(tab.url).origin,
      title: safeRecordingText(tab.title ?? new URL(tab.url).hostname),
    };
  }

  /**
   * Returns a current-page preview only to the owned manager, never to arbitrary content scripts.
   */
  private async view(): Promise<RecordingView> {
    let current: RecordingView['current'] = null;
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) {
      try {
        current = await this.target(tab.id);
      } catch {
        current = null;
      }
    }
    return { active: this.active, recent: (await this.repository.page('', null, 5)).items, current };
  }

  /**
   * Checks both the recording id and browser-authenticated document before accepting page commands.
   */
  private owned(id: string, sender?: Sender): RecordingSession {
    const session = this.active;
    if (!session || session.id !== id) {
      throw new Error('RECORDING_STALE');
    }
    if (sender) {
      const page = session.pages.find((item) => item.tabId === sender.tab?.id && item.included);
      if (
        !page ||
        page.documentId !== sender.documentId ||
        sender.tab?.windowId !== session.windowId ||
        !session.origins.includes(new URL(sender.url!).origin)
      ) {
        throw new Error('RECORDING_FORBIDDEN');
      }
    }
    return session;
  }

  /**
   * Routes finite use cases; page draining remains outside serialized mutations to avoid deadlocks.
   */
  private async dispatch(command: RecordingRequest, sender?: Sender): Promise<unknown> {
    await this.initialize();
    if (sender) {
      try {
        const target = await this.target(sender.tab!.id!);
        const session = this.active;
        if (
          session?.pages.some((page) => page.tabId === target.tabId && page.included) &&
          (target.windowId !== session.windowId || !session.origins.includes(target.origin))
        ) {
          throw new Error('FORBIDDEN_PAGE');
        }
      } catch (error) {
        await this.revalidate();
        throw new Error('RECORDING_FORBIDDEN', { cause: error });
      }
    }
    if (command.type === 'recorder.control') {
      this.owned(command.sessionId, sender);
      if (command.action !== 'resume') {
        return this.drain(command.sessionId, command.action);
      }
    }
    return this.serial(async () => {
      if (command.type === 'recorder.status') {
        return this.view();
      }
      if (command.type === 'recorder.list') {
        return this.repository.page(command.query, command.cursor);
      }
      if (command.type === 'recorder.detail') {
        return {
          session: await this.repository.get(command.sessionId),
          events: await this.repository.events(command.sessionId, command.after),
        };
      }
      if (command.type === 'recorder.start') {
        await this.repository.prune(Date.now());
        if (this.active) {
          throw new Error('RECORDING_BUSY');
        }
        if (this.bridgeBusy()) {
          throw new Error('BROWSER_BUSY');
        }
        const target = await this.target(command.tabId);
        if (this.bridgeBusy()) {
          throw new Error('BROWSER_BUSY');
        }
        const now = Date.now();
        const session: RecordingSession = {
          id: crypto.randomUUID(),
          name: `${target.title || '网页操作'}录制`.slice(0, 80),
          status: 'recording',
          startedAt: now,
          updatedAt: now,
          elapsedMs: 0,
          resumedAt: now,
          windowId: target.windowId,
          origins: [target.origin],
          includeRelated: command.includeRelated,
          pages: [{ ...target, tabRef: 'tab-1', lastBatch: 0, included: true }],
          epoch: 1,
          count: 0,
          actionCount: 0,
          recentEvents: [],
          bytes: 0,
          gaps: [],
        };
        this.active = session; // Reserve before yielding; Bridge admission sees this ownership immediately.
        try {
          await this.repository.save(session);
          await browser.storage.session.set({ recordingSessionId: session.id });
          await this.probe(target.tabId);
        } catch (error) {
          session.status = 'interrupted';
          session.resumedAt = null;
          session.gaps.push('未能确认页面工具栏，录制未启动。');
          await this.repository.save(session);
          this.active = null;
          throw error;
        }
        this.notify();
        return session;
      }
      if (command.type === 'recorder.hello') {
        if (!sender) {
          return { session: null, lastBatch: 0 };
        }
        const session = await this.hello(sender);
        const page = session?.pages.find(
          (item) => item.tabId === sender.tab?.id && item.documentId === sender.documentId
        );
        return { session, lastBatch: page?.lastBatch ?? 0 };
      }
      if (command.type === 'recorder.depart') {
        const session = this.owned(command.sessionId, sender);
        const page = session.pages.find((item) => item.tabId === sender?.tab?.id);
        if (!page) {
          throw new Error('RECORDING_FORBIDDEN');
        }
        page.sealed = true;
        await this.repository.save(session);
        return true;
      }
      if (command.type === 'recorder.batch') {
        if (!sender) {
          throw new Error('RECORDING_FORBIDDEN');
        }
        return this.batch(command, sender);
      }
      if (command.type === 'recorder.gap') {
        const session = this.owned(command.sessionId, sender);
        const messages = {
          delivery: '页面事件未能确认送达，录制已暂停。',
          overflow: '页面事件超过待发送限额，录制已暂停。',
          pagehide: '页面退出前尾部事件未确认，可能存在缺口。',
          frame: '页面包含 iframe，其中的操作不在当前录制范围内。',
        };
        this.gap(session, messages[command.reason]);
        if (['delivery', 'overflow'].includes(command.reason)) {
          this.pauseClock(session);
          session.status = 'paused';
          session.epoch++;
        }
        await this.repository.save(session);
        this.notify();
        return session;
      }
      if (command.type === 'recorder.rename' || command.type === 'recorder.delete') {
        const session = await this.repository.get(command.sessionId);
        if (!session || isActive(session)) {
          throw new Error('RECORDING_BUSY');
        }
        if (command.type === 'recorder.delete') {
          await this.repository.delete(session.id);
        } else {
          session.name = command.name;
          await this.repository.save(session);
        }
        this.notify();
        return true;
      }
      const session = this.owned(command.sessionId, sender);
      if (this.draining || session.status === 'stopping') {
        throw new Error('RECORDING_BUSY');
      }
      if (command.type === 'recorder.control') {
        if (session.status !== 'paused' || this.failure) {
          throw new Error('RECORDING_STALE');
        }
        session.status = 'recording';
        session.epoch++;
        session.resumedAt = Date.now();
        for (const page of session.pages.filter((item) => item.included)) {
          try {
            const target = await this.target(page.tabId);
            if (!session.origins.includes(target.origin) || target.windowId !== session.windowId) {
              page.included = false;
            }
          } catch {
            page.included = false;
          }
        }
        if (!session.pages.some((page) => page.included)) {
          session.status = 'paused';
          session.resumedAt = null;
          throw new Error('FORBIDDEN_PAGE');
        }
      } else if (command.type === 'recorder.include') {
        const target = await this.target(command.tabId);
        if (target.windowId !== session.windowId || this.bridgeBusy()) {
          throw new Error('BROWSER_BUSY');
        }
        this.include(session, target);
        await this.probe(target.tabId);
      } else if (command.type === 'recorder.remove') {
        const page = session.pages.find((item) => item.tabId === command.tabId);
        if (page) {
          page.included = false;
          this.gap(session, '页面已移出录制范围，末尾未提交操作可能缺失。');
        }
        if (!session.pages.some((item) => item.included)) {
          this.pauseClock(session);
          session.status = 'paused';
        }
      }
      session.updatedAt = Date.now();
      await this.repository.save(session);
      this.notify();
      return session;
    });
  }

  /**
   * Adds one explicitly authorized target without treating installation permissions as recording consent.
   */
  private include(session: RecordingSession, target: { tabId: number; origin: string; title: string }): void {
    const existing = session.pages.find((page) => page.tabId === target.tabId);
    if (!existing && session.pages.length >= recordingLimits.tabs) {
      throw new Error('RECORDING_LIMIT');
    }
    if (!session.origins.includes(target.origin)) {
      session.origins.push(target.origin);
    }
    if (existing) {
      existing.included = true;
      existing.origin = target.origin;
    } else {
      session.pages.push({
        ...target,
        tabRef: `tab-${session.pages.length + 1}`,
        included: true,
        lastBatch: 0,
      });
    }
  }

  /**
   * Probes without page effects and repairs only a genuinely absent fixed content receiver.
   */
  private async probe(tabId: number): Promise<void> {
    try {
      await browser.tabs.sendMessage(tabId, { type: 'recorder.probe' }, { frameId: 0 });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/Receiving end does not exist|Could not establish connection/.test(error.message)
      ) {
        throw new Error('RECORDING_DELIVERY', { cause: error });
      }
      await this.target(tabId);
      await browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['/content-scripts/content.js'],
        world: 'ISOLATED',
      });
    }
    // The receiver's hello is independent of this serial operation.
  }

  /**
   * Binds newly loaded top documents from trusted sender metadata, including opted-in opener relationships.
   */
  private async hello(sender: Sender): Promise<RecordingSession | null> {
    const session = this.active;
    if (
      !session ||
      session.status === 'stopping' ||
      this.failure ||
      sender.tab?.windowId !== session.windowId
    ) {
      return null;
    }
    const tabId = sender.tab!.id!;
    const tab = await browser.tabs.get(tabId);
    if (tab.windowId !== session.windowId || !tab.url || !session.origins.includes(new URL(tab.url).origin)) {
      return null;
    }
    const origin = new URL(sender.url!).origin;
    let page = session.pages.find((item) => item.tabId === tabId);
    if (
      !page &&
      session.includeRelated &&
      tab.openerTabId !== undefined &&
      session.pages.some((item) => item.tabId === tab.openerTabId && item.included) &&
      session.origins.includes(origin)
    ) {
      this.include(session, await this.target(tabId));
      page = session.pages.find((item) => item.tabId === tabId);
      await this.addBrowserFact(session, page!, 'tab_open', '打开关联标签页', sender.url!);
    }
    if (!page?.included || !session.origins.includes(origin)) {
      return null;
    }
    await this.target(tabId);
    if (page.documentId !== sender.documentId) {
      if (page.documentId && !page.sealed) {
        this.gap(session, '页面文档已变化，未确认的尾部操作可能缺失。');
      }
      page.documentId = sender.documentId;
      page.lastBatch = 0;
      page.origin = origin;
      page.sealed = false;
      await this.repository.save(session);
    }
    page.sealed = false;
    await this.repository.save(session);
    return session;
  }

  /**
   * Deduplicates ordered producer batches and commits all facts before acknowledging their batch number.
   */
  private async batch(command: Extract<RecordingRequest, { type: 'recorder.batch' }>, sender: Sender) {
    const session = this.owned(command.sessionId, sender);
    const target = await this.target(sender.tab!.id!);
    // The queue may have waited since dispatch checked scope; recheck before committing the batch.
    if (target.windowId !== session.windowId || !session.origins.includes(target.origin)) {
      throw new Error('RECORDING_FORBIDDEN');
    }
    const page = session.pages.find((item) => item.tabId === sender.tab!.id)!;
    if (command.epoch !== session.epoch || (session.status !== 'recording' && !this.draining)) {
      throw new Error('RECORDING_STALE');
    }
    if (command.batch <= page.lastBatch) {
      return { batch: command.batch, session };
    }
    if (
      command.batch !== page.lastBatch + 1 ||
      new TextEncoder().encode(JSON.stringify(command)).length > recordingLimits.batchBytes
    ) {
      throw new Error('RECORDING_LIMIT');
    }
    const clean = command.events.map((event) => ({
      ...event,
      label: safeRecordingText(event.label),
      url: safeRecordingUrl(sender.url!),
      ...(event.targetUrl ? { targetUrl: safeRecordingUrl(event.targetUrl) } : {}),
      ...(['input', 'select'].includes(event.action) ? { redacted: true } : {}),
    }));
    const bytes = new TextEncoder().encode(JSON.stringify(clean)).length;
    const total = (await this.repository.list()).reduce((sum, item) => sum + item.bytes, 0);
    if (
      session.count + clean.length > recordingLimits.events ||
      session.bytes + bytes > recordingLimits.sessionBytes ||
      total + bytes > recordingLimits.totalBytes
    ) {
      this.pauseClock(session);
      session.status = 'paused';
      this.gap(session, '录制达到存储限额，后续事件未保存。');
      await this.repository.save(session);
      this.notify();
      throw new Error('RECORDING_LIMIT');
    }
    const next = structuredClone(session);
    const events: RecordedEvent[] = clean.map((event) => ({
      ...event,
      sessionId: session.id,
      seq: ++next.count,
      tabRef: page.tabRef,
      documentId: sender.documentId!,
      source: 'dom',
    }));
    next.bytes += bytes;
    next.updatedAt = Date.now();
    next.pages.find((item) => item.tabId === page.tabId)!.lastBatch = command.batch;
    const updates = normalizeRecordingEvents(next, events);
    await this.repository.save(next, events, updates);
    this.active = next;
    this.notify();
    return { batch: command.batch, session: next };
  }

  /**
   * Adds a finite browser fact, retaining a causal hint for clicks that opened or navigated pages.
   */
  private async addBrowserFact(
    session: RecordingSession,
    page: RecordingPage,
    action: RecordingFact['action'],
    label: string,
    url = ''
  ): Promise<void> {
    if (session.status !== 'recording') {
      return;
    }
    const event: RecordedEvent = {
      id: crypto.randomUUID(),
      at: Date.now(),
      action,
      label,
      url: safeRecordingUrl(url),
      sessionId: session.id,
      seq: session.count + 1,
      tabRef: page.tabRef,
      documentId: page.documentId ?? '',
      source: 'browser',
    };
    const bytes = new TextEncoder().encode(JSON.stringify(event)).length;
    const total = (await this.repository.list()).reduce((sum, item) => sum + item.bytes, 0);
    if (
      session.count >= recordingLimits.events ||
      session.bytes + bytes > recordingLimits.sessionBytes ||
      total + bytes > recordingLimits.totalBytes
    ) {
      this.pauseClock(session);
      session.status = 'paused';
      this.gap(session, '录制达到事件限额。');
      await this.repository.save(session);
      return;
    }
    const next = structuredClone(session);
    next.count++;
    next.bytes += bytes;
    next.updatedAt = Date.now();
    const updates = normalizeRecordingEvents(next, [event]);
    await this.repository.save(next, [event], updates);
    session.count = next.count;
    session.actionCount = next.actionCount;
    session.bytes = next.bytes;
    session.updatedAt = next.updatedAt;
    session.recentEvents = next.recentEvents;
  }

  /**
   * Stops capture first, lets document flushes use the queue, then seals the epoch and durable result.
   */
  private async drain(id: string, action: 'pause' | 'stop'): Promise<RecordingSession> {
    let ownsDrain = false;
    try {
      const pages = await this.serial(async () => {
        const session = this.owned(id);
        if (this.draining) {
          throw new Error('RECORDING_BUSY');
        }
        this.draining = true;
        ownsDrain = true;
        this.pauseClock(session);
        session.status = action === 'stop' ? 'stopping' : 'paused';
        await this.repository.save(session);
        return session.pages.filter((page) => page.included && page.documentId);
      });
      const results = await Promise.all(
        pages.map(async (page) => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const reply = await Promise.race([
              browser.tabs.sendMessage(
                page.tabId,
                { type: 'recorder.flush', sessionId: id },
                { documentId: page.documentId }
              ),
              new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('RECORDING_DELIVERY')), 3000);
              }),
            ]);
            return reply?.flushed === true;
          } catch {
            return false;
          } finally {
            if (timeout) {
              clearTimeout(timeout);
            }
          }
        })
      );
      return await this.serial(async () => {
        const session = this.owned(id);
        session.epoch++;
        session.updatedAt = Date.now();
        if (results.some((result) => !result)) {
          this.gap(session, '部分页面未确认最后批次，末尾操作可能缺失。');
        }
        if (action === 'stop') {
          session.status = 'stopped';
        }
        await this.repository.save(session);
        this.failure = null;
        if (action === 'stop') {
          this.active = null;
          await browser.storage.session.remove('recordingSessionId');
        }
        this.notify(session.pages);
        return session;
      });
    } finally {
      if (ownsDrain) {
        this.draining = false;
      }
    }
  }

  /**
   * Accumulates only active capture time before a pause or terminal transition.
   */
  private pauseClock(session: RecordingSession): void {
    if (session.resumedAt !== null) {
      session.elapsedMs += Math.max(0, Date.now() - session.resumedAt);
      session.resumedAt = null;
    }
  }

  /**
   * Keeps bounded, non-sensitive evidence of unavailable capture coverage.
   */
  private gap(session: RecordingSession, text: string): void {
    if (!session.gaps.includes(text) && session.gaps.length < 32) {
      session.gaps.push(text);
    }
  }

  /**
   * Publishes only projections, without waiting on content scripts from inside the mutation queue.
   */
  private notify(pages = this.active?.pages ?? []): void {
    const session = this.active;
    const tasks: Promise<unknown>[] = [browser.storage.local.set({ recordingRevision: crypto.randomUUID() })];
    for (const page of pages) {
      tasks.push(
        browser.tabs.sendMessage(
          page.tabId,
          { type: 'recorder.state', session: page.included ? session : null },
          { frameId: 0 }
        )
      );
    }
    void Promise.allSettled(tasks).then(() => undefined);
  }

  /**
   * Revokes membership when permission or page availability changes; no automatic rejoin on recovery.
   */
  async revalidate(): Promise<void> {
    await this.initialize();
    await this.serial(async () => {
      const session = this.active;
      if (!session) {
        return;
      }
      let changed = false;
      for (const page of session.pages.filter((item) => item.included)) {
        try {
          const target = await this.target(page.tabId);
          if (target.windowId !== session.windowId || !session.origins.includes(target.origin)) {
            throw new Error('FORBIDDEN_PAGE');
          }
        } catch {
          page.included = false;
          changed = true;
        }
      }
      if (!changed) {
        return;
      }
      this.gap(session, '页面权限已撤回或页面不可用，已停止该页采集；未确认操作可能缺失。');
      session.updatedAt = Date.now();
      if (!session.pages.some((page) => page.included) && !this.draining) {
        this.pauseClock(session);
        session.status = 'interrupted';
      }
      // Clear page capture promptly even if saving the loss evidence subsequently fails.
      this.notify(session.pages);
      await this.repository.save(session);
      if (session.status === 'interrupted') {
        this.active = null;
        await browser.storage.session.remove('recordingSessionId');
        this.notify(session.pages);
      }
    });
  }

  /**
   * Handles browser lifecycle notifications without unhandled listener rejections.
   */
  availabilityChanged(): void {
    void this.revalidate().catch((error: unknown) => {
      this.error(error);
    });
  }

  /**
   * Processes browser observations only for participating tabs and persists terminal loss evidence.
   */
  observe(
    tabId: number,
    action: 'navigate' | 'tab_activate' | 'tab_close' | 'tab_move',
    url = '',
    detached = false
  ): void {
    void this.initialize()
      .then(() =>
        this.serial(async () => {
          const session = this.active;
          const page = session?.pages.find((item) => item.tabId === tabId && item.included);
          if (!session || !page) {
            return;
          }
          const labels = {
            navigate: '页面导航',
            tab_activate: '切换到页面',
            tab_close: '关闭页面',
            tab_move: '移动标签页',
          };
          if (action !== 'tab_close' && !detached) {
            try {
              await this.target(tabId);
            } catch {
              this.availabilityChanged();
              return;
            }
          }
          const allowedUrl = !url || (safeRecordingUrl(url) && session.origins.includes(new URL(url).origin));
          await this.addBrowserFact(session, page, action, labels[action], allowedUrl ? url : '');
          if (
            action === 'navigate' &&
            (!safeRecordingUrl(url) || !session.origins.includes(new URL(url).origin))
          ) {
            page.included = false;
            this.gap(session, '页面已跳转至范围外站点，未继续采集。');
          }
          if (action === 'tab_close' || detached) {
            page.included = false;
            if (!page.sealed) {
              this.gap(session, '页面关闭、替换或移出窗口，未确认尾批次可能缺失。');
            }
          }
          if (!session.pages.some((item) => item.included) && !this.draining) {
            this.pauseClock(session);
            session.status = 'interrupted';
            this.active = null;
            await browser.storage.session.remove('recordingSessionId');
          }
          session.updatedAt = Date.now();
          await this.repository.save(session);
          this.notify(session.pages);
        })
      )
      .catch((error: unknown) => {
        this.error(error);
      });
  }
}
