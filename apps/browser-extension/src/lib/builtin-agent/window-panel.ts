/**
 * @author Codex
 * @description Registers genuine browser side-panel documents and routes one window's agent transport independently of its UI navigation.
 */
import { browser } from 'wxt/browser';
import type { WindowPanelRoute } from './skill-messages';
type Port = ReturnType<typeof browser.runtime.connect>;
type Panel = { port: Port; windowId: number; documentId: string; url: string };
export class WindowPanels {
  private readonly panels = new Map<string, Panel>();
  private readonly pending = new Map<number, { route: WindowPanelRoute; expiresAt: number }>();
  /**
   * Registers only SIDE_PANEL contexts; loading the panel URL in a normal tab grants no execution authority.
   */
  connect(port: Port, disconnected: (documentId: string) => void): void {
    if (!/^octopus-window-panel:\d+$/.test(port.name)) {
      return;
    }
    const windowId = Number(port.name.split(':')[1]);
    let closed = false;
    let documentId: string | undefined;
    const url = port.sender?.url;
    // Messages keep Worker alive only during a bounded in-flight model request.
    port.onMessage.addListener(() => {});
    port.onDisconnect.addListener(() => {
      closed = true;
      if (documentId && this.panels.get(documentId)?.port === port) {
        this.panels.delete(documentId);
        this.pending.delete(windowId);
        disconnected(documentId);
      }
    });
    void (async () => {
      if (
        port.sender?.id !== browser.runtime.id ||
        port.sender.tab !== undefined ||
        !url?.startsWith(browser.runtime.getURL('/window-panel.html') + '?instance=')
      ) {
        throw Error('SKILL_FORBIDDEN');
      }
      const contexts = await browser.runtime.getContexts({
        contextTypes: ['SIDE_PANEL'],
        documentUrls: [url!],
      });
      const context = contexts.find((value) => value.documentUrl === url && !value.incognito);
      documentId = context?.documentId;
      const window = await browser.windows.get(windowId);
      if (
        !context ||
        !documentId ||
        (port.sender?.documentId && port.sender.documentId !== documentId) ||
        window.incognito ||
        window.type !== 'normal' ||
        closed ||
        this.panels.has(documentId) ||
        [...this.panels.values()].some((panel) => panel.windowId === windowId)
      ) {
        throw Error('SKILL_FORBIDDEN');
      }
      const key = 'windowPanelRoute:' + windowId;
      const saved = (await browser.storage.session.get(key))[key];
      const queued = this.pending.get(windowId);
      const pending = queued && queued.expiresAt > Date.now() ? queued.route : undefined;
      this.pending.delete(windowId);
      if (!closed) {
        this.panels.set(documentId, { port, documentId, windowId, url: url! });
        port.postMessage({
          type: 'panel.ready',
          windowId: windowId,
          route: pending ?? saved,
          autoStart: Boolean(pending),
        });
      }
    })().catch(() => {
      try {
        port.disconnect();
      } catch {
        /* Already closed. */
      }
    });
  }
  /**
   * Maps an exact per-document URL to its browser-verified side-panel registration.
   */
  fromUrl(url: string | undefined): Panel | undefined {
    return [...this.panels.values()].find((panel) => panel.url === url);
  }
  /**
   * Resolves the live document identity, never a caller-supplied window number.
   */
  get(documentId: string | undefined): Panel | undefined {
    return documentId ? this.panels.get(documentId) : undefined;
  }
  /**
   * Delivers a registered turn; failure leaves the task interrupted rather than creating a tab.
   */
  send(documentId: string | undefined, message: unknown): void {
    const panel = this.get(documentId);
    if (!panel) {
      throw Error('SKILL_HOST_CLOSED');
    }
    panel.port.postMessage(message);
  }
  /**
   * Stores only a navigation target; reopening it never authorizes a new task automatically.
   */
  async forget(sessionId: string): Promise<void> {
    const values = await browser.storage.session.get(null);
    const keys = Object.entries(values)
      .filter(
        ([key, value]) =>
          key.startsWith('windowPanelRoute:') &&
          value &&
          typeof value === 'object' &&
          'sessionId' in value &&
          value.sessionId === sessionId
      )
      .map(([key]) => key);
    if (keys.length) {
      await browser.storage.session.remove(keys);
    }
  }
  /**
   * Persists an explicit view without executing it.
   */
  async remember(windowId: number, route?: WindowPanelRoute): Promise<void> {
    const key = 'windowPanelRoute:' + windowId;
    if (route) {
      await browser.storage.session.set({ [key]: route });
    } else {
      await browser.storage.session.remove(key);
    }
  }
  /**
   * Delivers an explicit navigation without changing running task ownership.
   */
  async route(windowId: number, route: WindowPanelRoute, autoStart = true): Promise<void> {
    await this.remember(windowId, route);
    const panel = [...this.panels.values()].find((value) => value.windowId === windowId);
    if (panel) {
      this.send(panel.documentId, { type: 'panel.route', route, autoStart });
    } else if (autoStart) {
      this.pending.set(windowId, { route, expiresAt: Date.now() + 15000 });
    }
  }
}
