/**
 * @author Codex
 * @description Delegates page snapshots, element indices, native feedback and actions to one task-owned PageController.
 */
import { PageController } from '@page-agent/page-controller';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { browser } from 'wxt/browser';
import { snapshotPageSchema } from '@octopus/shared/protocol/browser-tools';
import { pageRequestSchema, pageOwner, pageOwnerKey, type PageOwner } from './page-commands';
import type { BrowserSkillChoice } from '@octopus/shared/protocol/browser-skills';
import { safeRecordingText } from './lib/recording/recording-privacy';
import { choiceOnPage, locateChoice, protectedChoiceElements } from './lib/recording/page-choices';
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
  private readonly controllerOptions = { enableMask: true, interactiveBlacklist: [] as Element[] };
  private choiceTarget?: Element;
  private choices: BrowserSkillChoice[] = [];
  private choiceIndexFailed = false;

  /**
   * Uses the upstream public blacklist configuration to create a singleton index for a resolved choice.
   * The synchronous beforeUpdate hook enumerates current scopes; no private selectorMap or text parser is used.
   */
  private prepareChoiceIndex = (): void => {
    this.choiceIndexFailed = false;
    if (!this.choiceTarget && this.choices.length === 0) {
      this.controllerOptions.interactiveBlacklist = [];
      return;
    }
    try {
      const scopes = this.collectAccessibleRoots();
      if (this.choiceTarget) {
        const all = scopes.flatMap((scope) => [...scope.querySelectorAll('*')]);
        if (all.length > 20000) {
          throw Error('SKILL_CHOICE_LIMIT');
        }
        this.controllerOptions.interactiveBlacklist = all.filter((element) => element !== this.choiceTarget);
      } else {
        this.controllerOptions.interactiveBlacklist = this.choices.length
          ? protectedChoiceElements(scopes)
          : [];
      }
    } catch {
      this.choiceIndexFailed = true;
    }
  };

  /**
   * Performs one requirement-bound action and re-observes state; known refusals never dispatch a click.
   */
  private async applyChoice(id: string) {
    if (!this.alive || !this.controller || !this.scopesCurrent()) {
      return { status: 'page_changed', businessEffect: 'none', next: 'browser_snapshot' };
    }
    const choice = this.choices.find((item) => item.id === id);
    if (!choice) {
      return { status: 'invalid_requirement', businessEffect: 'none' };
    }
    const before = locateChoice(choice, this.scopes);
    if (before.status !== 'resolved') {
      return { status: before.status, businessEffect: 'none', next: 'ask_user_question' };
    }
    if (before.satisfied) {
      return { status: 'satisfied', businessEffect: 'none', requirementId: id };
    }
    if (
      (choice.control.role === 'radio' && choice.control.state === false) ||
      (before.element instanceof HTMLSelectElement &&
        (before.element.multiple ||
          !Array.isArray(choice.control.state) ||
          choice.control.state.length !== 1))
    ) {
      return { status: 'unsupported', businessEffect: 'none', next: 'ask_user_question' };
    }
    this.choiceTarget = before.activation;
    this.snapshot = undefined;
    let dispatched = false;
    try {
      await this.controller!.getBrowserState();
      if (this.choiceIndexFailed) {
        return { status: 'unsupported', businessEffect: 'none' };
      }
      const current = locateChoice(choice, this.scopes);
      if (
        !this.alive ||
        current.status !== 'resolved' ||
        current.element !== before.element ||
        current.activation !== before.activation ||
        !this.scopesCurrent()
      ) {
        return { status: 'page_changed', businessEffect: 'none', next: 'browser_snapshot' };
      }
      if (current.satisfied) {
        return { status: 'satisfied', businessEffect: 'none', requirementId: id };
      }
      // All other elements were blacklisted synchronously during the same index build.
      dispatched = true;
      let result: { success: boolean };
      if (current.element instanceof HTMLSelectElement && Array.isArray(choice.control.state)) {
        const desired = choice.control.state[0];
        const option = [...current.element.options].find((item) => safeRecordingText(item.label) === desired);
        if (!option) {
          return { status: 'unavailable', businessEffect: 'none' };
        }
        const text = option.textContent?.trim() ?? '';
        if ([...current.element.options].filter((item) => item.textContent?.trim() === text).length !== 1) {
          return { status: 'ambiguous', businessEffect: 'none' };
        }
        result = await this.controller!.selectOption(0, text);
      } else {
        result = await this.controller!.clickElement(0);
      }
      const after = locateChoice(choice, this.scopes);
      if (
        !result.success ||
        after.status !== 'resolved' ||
        !after.satisfied ||
        !this.alive ||
        !this.scopesCurrent()
      ) {
        return { status: 'outcome_unknown', businessEffect: 'unknown' };
      }
      return { status: 'satisfied', businessEffect: 'applied', requirementId: id };
    } catch {
      return {
        status: dispatched ? 'outcome_unknown' : 'unsupported',
        businessEffect: dispatched ? 'unknown' : 'none',
      };
    } finally {
      this.choiceTarget = undefined;
      this.controllerOptions.interactiveBlacklist = [];
    }
  }
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
  private ownerKey = '';
  private taskId = '';
  private ending = false;
  private documentRevision = '';
  private scopeUrls = new Map<Document, string>();
  private scopes: (Document | ShadowRoot)[] = [document];
  private inaccessibleFrames = 0;
  /**
   * Tracks bounded same-origin document roots while leaving inaccessible frames opaque, as the upstream extractor does.
   */
  private collectAccessibleRoots(): (Document | ShadowRoot)[] {
    const scopes: (Document | ShadowRoot)[] = [];
    this.inaccessibleFrames = 0;
    let nodes = 0;
    /**
     * Walks accessible roots without assigning or changing PageController indices.
     */
    const visit = (root: Document | ShadowRoot): void => {
      if (scopes.length >= 128) {
        throw new Error('SNAPSHOT_LIMIT');
      }
      scopes.push(root);
      for (const element of root.querySelectorAll('*')) {
        if (++nodes > 100000) {
          throw new Error('SNAPSHOT_LIMIT');
        }
        if (element.shadowRoot) {
          visit(element.shadowRoot);
        }
        if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
          const frame = element as HTMLIFrameElement;
          let child: Document | null;
          try {
            child = frame.contentDocument;
          } catch {
            this.inaccessibleFrames++;
            continue;
          }
          if (!child) {
            this.inaccessibleFrames++;
            continue;
          }
          visit(child);
        }
      }
    };
    visit(document);
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
   * Checks observed document identity without rebuilding indices. Screenshots and choices also require complete scope coverage.
   */
  private scopesCurrent(exact = true) {
    const current = this.collectAccessibleRoots();
    const present = new Set(current);
    return (
      (!exact || current.length === this.scopes.length) &&
      this.scopes.every((root) => present.has(root)) &&
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
  bind(owner: PageOwner, documentRevision: string, taskId?: string) {
    const ownerKey = pageOwnerKey(owner);
    if (
      (this.ownerKey && this.ownerKey !== ownerKey) ||
      (this.documentRevision && this.documentRevision !== documentRevision) ||
      (taskId && this.taskId && this.taskId !== taskId)
    ) {
      this.reset(true);
    }
    this.ownerKey = ownerKey;
    this.documentRevision = documentRevision;
    if (taskId) {
      this.taskId = taskId;
    }
  }
  /**
   * Invalidates restored or detached contexts without retaining executable references.
   */
  reset(alive: boolean) {
    this.choiceTarget = undefined;
    this.choices = [];
    this.controllerOptions.interactiveBlacklist = [];
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
  endTask(taskId: string, owner?: PageOwner) {
    const ownerKey = owner ? pageOwnerKey(owner) : this.ownerKey;
    if (this.taskId !== taskId || this.ownerKey !== ownerKey) {
      return;
    }
    if (this.busy) {
      this.ending = true;
    } else {
      this.reset(true);
    }
  }

  /**
   * Confirms old local work has drained before a user acknowledgement releases an uncertain reservation.
   */
  releaseIfIdle(taskId: string, owner: PageOwner): { released: boolean } {
    if (this.taskId !== taskId || this.ownerKey !== pageOwnerKey(owner)) {
      return { released: true };
    }
    if (this.busy || this.screenshotRestore) {
      return { released: false };
    }
    this.endTask(taskId, owner);
    return { released: true };
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
    if (
      this.screenshotRestore ||
      !this.snapshotCurrent(snapshotId, controllerId, documentId) ||
      this.inaccessibleFrames > 0
    ) {
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
    const command = pageRequestSchema.parse(raw);
    if (pageOwnerKey(pageOwner(command)) !== this.ownerKey) {
      throw new Error('TARGET_CHANGED');
    }
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
      this.choices = 'localRunId' in command ? (command.choiceRequirements ?? []) : [];
      if (!('tabId' in params)) {
        throw new Error('INVALID_MESSAGE');
      }
      if (command.method === 'browser_snapshot') {
        this.snapshot = undefined;
        if (!this.controller) {
          this.controller = new PageController(this.controllerOptions);
          this.controller.addEventListener('beforeUpdate', this.prepareChoiceIndex);
        }
        const controller = this.controller;
        // Native feedback stays visible through observation, actions and caller thinking gaps.
        await controller.showMask();
        if (!this.alive || this.controller !== controller) {
          controller.dispose();
          throw new Error('TARGET_CHANGED');
        }
        this.rememberScopes(this.collectAccessibleRoots());
        const state = await controller.getBrowserState();
        if (this.choiceIndexFailed) {
          throw Error('TARGET_CHANGED');
        }
        if (!this.alive || this.controller !== controller) {
          throw new Error('TARGET_CHANGED');
        }
        if (state.url !== location.href || !this.scopesCurrent()) {
          throw new Error('TARGET_CHANGED');
        }
        let text = [state.header, state.content, state.footer].join('\n');
        if (this.inaccessibleFrames) {
          text += `\n[${this.inaccessibleFrames} 个不可访问的子页面未读取；当前快照仅包含可访问内容，不代表整页权限不足。]`;
        }
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
      if (command.method === 'apply_choice') {
        return await this.applyChoice(command.params.requirementId);
      }
      if ('localRunId' in command && command.method === 'browser_click') {
        for (const choice of this.choices.filter((item) => choiceOnPage(item, location.href))) {
          const current = locateChoice(choice, this.scopes);
          if (current.status !== 'resolved' || !current.satisfied) {
            return {
              status: 'choice_required',
              businessEffect: 'none',
              requirementId: choice.id,
              next: 'apply_choice',
            };
          }
        }
      }
      if (!this.scopesCurrent(this.choices.length > 0)) {
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
