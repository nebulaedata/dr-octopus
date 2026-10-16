/**
 * @author Codex
 * @description Delegates page snapshots, element indices, native feedback and actions to one task-owned PageController.
 */
import { PageController } from '@page-agent/page-controller';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { browser } from 'wxt/browser';
import { browserRequestSchema, snapshotPageSchema } from '@octopus/shared/protocol/browser-tools';
const encoder = new TextEncoder();
/**
 * Creates a random UUID using the CSPRNG available even on non-secure HTTP documents.
 */
function createControllerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export class PageControllerAdapter {
  private controller: PageController | undefined;
  private controllerId = createControllerId();
  private documentId = '';
  private snapshot:
    | {
        id: string;
        pages: string[];
        digest: string;
        bytes: number;
        expires: number;
        title: string;
        url: string;
      }
    | undefined;
  private busy = false;
  private screenshotRestore: (() => void) | undefined;
  private alive = true;
  private connectionId = '';
  private taskId = '';
  private ending = false;
  private documentRevision = '';
  private scopeUrls = new Map<Document, string>();
  private scopes: (Document | ShadowRoot)[] = [document];
  /**
   * Collects bounded observable roots, including one same-origin frame level and open shadow DOM.
   * Rejects unmonitorable frame trees before publishing executable references.
   */
  private collectScopes(): (Document | ShadowRoot)[] {
    const scopes: (Document | ShadowRoot)[] = [];
    let nodes = 0;
    /**
     * Walks accessible roots without assigning or changing PageController indices.
     */
    const visit = (root: Document | ShadowRoot, depth: number): void => {
      if (scopes.length >= 128) {
        throw new Error('SNAPSHOT_LIMIT');
      }
      scopes.push(root);
      for (const element of root.querySelectorAll('*')) {
        if (++nodes > 100000) {
          throw new Error('SNAPSHOT_LIMIT');
        }
        if (element.shadowRoot) {
          visit(element.shadowRoot, depth);
        }
        if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
          if (depth >= 1) {
            throw new Error('FORBIDDEN_PAGE');
          }
          const frame = element as HTMLIFrameElement;
          let child: Document | null;
          try {
            child = frame.contentDocument;
          } catch {
            throw new Error('FORBIDDEN_PAGE');
          }
          if (!child) {
            throw new Error('FORBIDDEN_PAGE');
          }
          visit(child, depth + 1);
        }
      }
    };
    visit(document, 0);
    return scopes;
  }
  /**
   * Records supported document roots without maintaining a second DOM mutation/indexing engine.
   */
  private rememberScopes(scopes: (Document | ShadowRoot)[]) {
    this.scopes = scopes;
    this.scopeUrls.clear();
    for (const scope of scopes) {
      if (scope.nodeType === 9) {
        this.scopeUrls.set(scope as Document, (scope as Document).URL);
      }
    }
  }
  /**
   * Rejects changed frame/shadow-root ownership without rebuilding the upstream element index.
   */
  private scopesCurrent() {
    const current = this.collectScopes();
    return (
      current.length === this.scopes.length &&
      current.every((root, index) => root === this.scopes[index]) &&
      [...this.scopeUrls].every(([root, url]) => root.URL === url)
    );
  }
  /**
   * Obtains the browser-owned sender document identity without trusting DOM attributes or URLs.
   */
  async identity() {
    const reply: unknown = await browser.runtime.sendMessage({
      type: 'page.ready',
      controllerId: this.controllerId,
    });
    if (
      !reply ||
      typeof reply !== 'object' ||
      !('documentId' in reply) ||
      typeof reply.documentId !== 'string'
    ) {
      throw new Error('TARGET_CHANGED');
    }
    this.documentId = reply.documentId;
    return { documentId: this.documentId, controllerId: this.controllerId };
  }
  /**
   * Reconnection invalidates prior page references while allowing an already entered action to finish.
   */
  bind(connectionId: string, documentRevision: string, taskId?: string) {
    if (
      (this.connectionId && this.connectionId !== connectionId) ||
      (this.documentRevision && this.documentRevision !== documentRevision) ||
      (taskId && this.taskId && this.taskId !== taskId)
    ) {
      this.reset(true);
    }
    this.connectionId = connectionId;
    this.documentRevision = documentRevision;
    if (taskId) {
      this.taskId = taskId;
    }
  }
  /**
   * Invalidates restored or detached contexts without retaining executable references.
   */
  reset(alive: boolean) {
    this.finishScreenshot();
    this.alive = alive;
    this.snapshot = undefined;
    this.controller?.dispose();
    this.controller = undefined;
    this.controllerId = createControllerId();
    this.taskId = '';
    this.ending = false;
  }
  /**
   * Releases native feedback after an entered action settles; stale task cleanup cannot affect a new task.
   */
  endTask(taskId: string, connectionId = this.connectionId) {
    if (this.taskId !== taskId || this.connectionId !== connectionId) {
      return;
    }
    if (this.busy) {
      this.ending = true;
    } else {
      this.reset(true);
    }
  }
  /**
   * Disposes the upstream controller when the extension context ends.
   */
  dispose() {
    this.reset(false);
    this.scopes = [];
    this.scopeUrls.clear();
  }
  /**
   * Temporarily redacts declared sensitive elements without replacing the upstream mask or DOM snapshot.
   */
  beginScreenshot(snapshotId: string, controllerId: string, documentId: string): boolean {
    if (this.screenshotRestore || !this.snapshotCurrent(snapshotId, controllerId, documentId)) {
      return false;
    }
    const saved: { element: HTMLElement; value: string; priority: string; hadStyle: boolean }[] = [];
    for (const scope of this.scopes) {
      for (const node of scope.querySelectorAll('input[type="password"],[data-executor-sensitive]')) {
        if (!('style' in node)) {
          continue;
        }
        const element = node as HTMLElement;
        saved.push({
          element,
          value: element.style.getPropertyValue('opacity'),
          priority: element.style.getPropertyPriority('opacity'),
          hadStyle: node.hasAttribute('style'),
        });
        element.style.setProperty('opacity', '0', 'important');
      }
    }
    this.screenshotRestore = () => {
      for (const { element, value, priority, hadStyle } of saved) {
        if (
          element.style.getPropertyValue('opacity') !== '0' ||
          element.style.getPropertyPriority('opacity') !== 'important'
        ) {
          continue;
        }
        if (value) {
          element.style.setProperty('opacity', value, priority);
        } else {
          element.style.removeProperty('opacity');
        }
        if (!hadStyle && element.getAttribute('style') === '') {
          element.removeAttribute('style');
        }
      }
    };
    return true;
  }
  /**
   * Releases temporary capture styles on completion, navigation, reset or disposal.
   */
  finishScreenshot() {
    const restore = this.screenshotRestore;
    this.screenshotRestore = undefined;
    restore?.();
  }
  /**
   * Checks snapshot, document and frame ownership without rebuilding the upstream element index.
   */
  snapshotCurrent(snapshotId: string, controllerId: string, documentId: string): boolean {
    if (
      !this.alive ||
      this.busy ||
      !this.snapshot ||
      this.snapshot.id !== snapshotId ||
      this.snapshot.expires <= Date.now() ||
      this.controllerId !== controllerId ||
      this.documentId !== documentId ||
      this.snapshot.url !== location.href
    ) {
      return false;
    }
    try {
      if (
        this.screenshotRestore &&
        this.scopes.some((scope) =>
          [...scope.querySelectorAll('input[type="password"],[data-executor-sensitive]')].some(
            (node) => !('style' in node) || (node as HTMLElement).style.opacity !== '0'
          )
        )
      ) {
        return false;
      }
      return this.scopesCurrent();
    } catch {
      return false;
    }
  }
  /**
   * Runs finite page methods; never refreshes indices before an action or returns input text in summaries.
   * Arbitrary scripts stay closed: pnpm patch removes the upstream executeJavascript method; no alternate channel is exposed.
   */
  async execute(raw: unknown) {
    const command = browserRequestSchema.parse(raw);
    if (!this.alive) {
      throw new Error('TARGET_CHANGED');
    }
    if (this.busy || this.screenshotRestore) {
      throw new Error('BROWSER_BUSY');
    }
    this.busy = true;
    try {
      if (!command.taskId) {
        throw new Error('INVALID_MESSAGE');
      }
      if (this.taskId && this.taskId !== command.taskId) {
        this.reset(true);
      }
      this.taskId = command.taskId;
      const identity = await this.identity();
      const params = command.params;
      if (!('tabId' in params)) {
        throw new Error('INVALID_MESSAGE');
      }
      if (command.method === 'browser_snapshot') {
        this.snapshot = undefined;
        this.controller ??= new PageController({ enableMask: true });
        const controller = this.controller;
        // Native feedback stays visible through observation, actions and caller thinking gaps.
        await controller.showMask();
        if (!this.alive || this.controller !== controller) {
          controller.dispose();
          throw new Error('TARGET_CHANGED');
        }
        this.rememberScopes(this.collectScopes());
        const state = await controller.getBrowserState();
        if (!this.alive || this.controller !== controller) {
          throw new Error('TARGET_CHANGED');
        }
        if (state.url !== location.href || state.title !== document.title || !this.scopesCurrent()) {
          throw new Error('TARGET_CHANGED');
        }
        let text = [state.header, state.content, state.footer].join('\n');
        for (const scope of this.scopes) {
          for (const element of scope.querySelectorAll('input[type="password"],[data-executor-sensitive]')) {
            const values = [
              element.textContent,
              element.tagName === 'INPUT' ? (element as HTMLInputElement).value : null,
            ];
            for (const value of values) {
              if (value) {
                text = text.split(value).join('[REDACTED]');
              }
            }
          }
        }
        const bytes = encoder.encode(text);
        if (bytes.length > 2097152) {
          throw new Error('SNAPSHOT_LIMIT');
        }
        const digest = bytesToHex(sha256(bytes));
        const pages: string[] = [];
        let part = '';
        let size = 0;
        for (const [character] of text.matchAll(/\[\d+\]|[\s\S]/gu)) {
          const length = encoder.encode(character).length;
          if (size + length > 24576) {
            pages.push(part);
            part = '';
            size = 0;
          }
          part += character;
          size += length;
        }
        pages.push(part);
        if (pages.length > 128) {
          throw new Error('SNAPSHOT_LIMIT');
        }
        this.snapshot = {
          id: createControllerId(),
          pages,
          digest,
          bytes: bytes.length,
          expires: Date.now() + 60000,
          title: state.title.slice(0, 4096),
          url: state.url,
        };
        return this.page(0);
      }
      const expected = 'target' in params ? params.target : params;
      if (
        !('snapshotId' in expected) ||
        !this.snapshot ||
        this.snapshot.id !== expected.snapshotId ||
        this.snapshot.expires <= Date.now()
      ) {
        throw new Error('SNAPSHOT_EXPIRED');
      }
      if (
        expected.documentId !== identity.documentId ||
        expected.controllerId !== identity.controllerId ||
        this.snapshot.url !== location.href
      ) {
        throw new Error('TARGET_CHANGED');
      }
      if (command.method === 'browser_read_snapshot') {
        return this.page(command.params.page);
      }
      if (!this.scopesCurrent()) {
        throw new Error('TARGET_CHANGED');
      }
      if (!this.controller) {
        throw new Error('STALE_SNAPSHOT');
      }
      let result: { success: boolean };
      const controller = this.controller;
      // Consume the transport reference; the upstream Controller and native feedback stay alive.
      this.snapshot = undefined;
      switch (command.method) {
        case 'browser_click':
          result = await controller.clickElement(command.params.target.elementIndex);
          break;
        case 'browser_fill':
          result = await controller.inputText(command.params.target.elementIndex, command.params.text);
          break;
        case 'browser_select':
          result = await controller.selectOption(
            command.params.target.elementIndex,
            command.params.optionText
          );
          break;
        case 'browser_scroll': {
          const { direction, pixels } = command.params;
          result =
            direction === 'left' || direction === 'right'
              ? await controller.scrollHorizontally({
                  right: direction === 'right',
                  pixels,
                  index: command.params.target.elementIndex,
                })
              : await controller.scroll({
                  down: direction === 'down',
                  numPages: 0,
                  pixels,
                  index: command.params.target.elementIndex,
                });
          break;
        }
        default:
          throw new Error('INVALID_MESSAGE');
      }
      return {
        businessEffect: result.success ? 'applied' : 'unknown',
        code: result.success ? 'ACTION_COMPLETED' : 'ACTION_FAILED',
      };
    } finally {
      this.busy = false;
      if (this.ending) {
        this.reset(true);
      }
    }
  }
  /**
   * Returns one immutable cached page without rebuilding the tree or reindexing references.
   */
  private page(index: number) {
    const cache = this.snapshot;
    if (!cache || cache.expires <= Date.now() || index >= cache.pages.length) {
      throw new Error('SNAPSHOT_EXPIRED');
    }
    return snapshotPageSchema.parse({
      documentId: this.documentId,
      controllerId: this.controllerId,
      snapshotId: cache.id,
      page: index,
      pages: cache.pages.length,
      totalBytes: cache.bytes,
      text: cache.pages[index],
      digest: cache.digest,
      title: cache.title,
      url: cache.url,
      expiresAt: cache.expires,
    });
  }
}
