/**
 * @author Codex
 * @description Captures bounded semantic user events without field values and owns page listener cleanup.
 */
import type { RecordingFact } from './recording-contract';
import { safeRecordingText, safeRecordingUrl } from './recording-privacy';
import { readChoiceControl, readLabelText, sensitiveControl } from './control-semantics';

export class DOMRecorder {
  private abort?: AbortController;
  private pending = new Map<Element, RecordingFact>();
  private timer?: ReturnType<typeof setTimeout>;
  private lastScroll = 0;
  private composing = false;
  private awaitingChange = new WeakSet<Element>();
  private frameReported = false;
  private targets = new WeakMap<Element, string>();
  private edits = new WeakMap<Element, string>();
  private nextTarget = 0;

  /**
   * Supplies the owned overlay to exclude and the bounded transport's event sink.
   */
  constructor(
    private readonly overlay: HTMLElement,
    private readonly emit: (event: RecordingFact) => void,
    private readonly reportFrame: () => void
  ) {}

  /**
   * Attaches once per active capture period, using composed paths for accessible shadow content.
   */
  start(): void {
    if (this.abort) {
      return;
    }
    this.abort = new AbortController();
    const options = { capture: true, passive: true, signal: this.abort.signal };
    for (const type of ['click', 'input', 'change', 'keydown', 'scroll', 'submit', 'blur']) {
      document.addEventListener(type, this.receive, options);
    }
    document.addEventListener('compositionstart', this.beginComposition, options);
    document.addEventListener('compositionend', this.endComposition, options);
    document.addEventListener('load', this.frameLoaded, options);
  }

  /**
   * Stops listeners and emits already coalesced inputs before the transport seals a batch.
   */
  stop(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.composing = false;
    this.flush();
    this.edits = new WeakMap();
  }

  /**
   * Commits the latest semantic input per field; no field values ever enter this map.
   */
  flush = (): void => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const fact of this.pending.values()) {
      this.emit(fact);
    }
    this.pending.clear();
  };

  /**
   * Delays input coalescing until IME composition completes.
   */
  private beginComposition = (): void => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.composing = true;
  };

  /**
   * Coalesces compositionend with the browser's following final input event without reading its value.
   */
  private endComposition = (): void => {
    this.composing = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(this.flush, 350);
  };

  /**
   * Reports dynamically loaded frames without observing DOM mutations or entering their documents.
   */
  private frameLoaded = (event: Event): void => {
    if (this.frameReported || event.composedPath().includes(this.overlay)) {
      return;
    }
    if (event.target instanceof HTMLIFrameElement || event.target instanceof HTMLFrameElement) {
      this.frameReported = true;
      this.reportFrame();
    }
  };

  /**
   * Converts trusted events into labels and action kinds, excluding extension controls and sensitive nodes.
   */
  private receive = (event: Event): void => {
    const path = event.composedPath();
    if (!event.isTrusted || path.includes(this.overlay)) {
      return;
    }
    // Viewport scrolls target Document, whose composed path contains no Element.
    const original =
      event.type === 'scroll' && event.target === document
        ? (document.scrollingElement ?? document.documentElement)
        : path.find((item): item is Element => item instanceof Element);
    let element =
      path.find(
        (item): item is Element =>
          item instanceof Element &&
          item.matches(
            'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [contenteditable="true"]'
          )
      ) ?? original;
    if (event.type === 'click') {
      const label = element?.closest('label');
      if (label instanceof HTMLLabelElement && label.control && readChoiceControl(label.control)) {
        element = label.control;
      }
    }
    if (!element) {
      return;
    }
    if (event.type === 'blur') {
      this.flush();
      this.edits = new WeakMap();
      return;
    }
    const sensitive = original?.closest(
      '[type="password"], [autocomplete="one-time-code"], [data-sensitive], [data-page-agent-sensitive], [data-executor-sensitive]'
    );
    if (sensitive || sensitiveControl(element)) {
      return;
    }
    // Browsers emit change after the input/IME value was already committed; it closes that edit,
    // rather than representing a second user edit. A change without any preceding input is retained.
    if (event.type === 'change' && this.awaitingChange.has(element)) {
      this.awaitingChange.delete(element);
      this.flush();
      this.edits.delete(element);
      return;
    }
    if (event.type === 'input') {
      this.awaitingChange.add(element);
    }
    let action: RecordingFact['action'] = 'click';
    let key: RecordingFact['key'];
    if (event.type === 'input' || event.type === 'change') {
      action = element instanceof HTMLSelectElement ? 'select' : 'input';
    } else if (event.type === 'keydown') {
      if (
        !(event instanceof KeyboardEvent) ||
        event.isComposing ||
        event.repeat ||
        !['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        return;
      }
      action = 'key';
      key = event.key as RecordingFact['key'];
    } else if (event.type === 'scroll') {
      if (Date.now() - this.lastScroll < 800) {
        return;
      }
      this.lastScroll = Date.now();
      action = 'scroll';
    } else if (event.type === 'submit') {
      action = 'submit';
    }
    // Labels are metadata only. Never copy innerText from an arbitrary container or editable field.
    let label = element.getAttribute('aria-label') ?? element.getAttribute('placeholder') ?? '';
    if (
      !label &&
      (element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement)
    ) {
      const associated = element.labels?.[0];
      label = associated ? readLabelText(associated) : '';
    }
    if (!label && element.matches('button, a, [role="button"]') && !element.closest('[contenteditable]')) {
      label = readLabelText(element);
    }
    const titles = {
      click: '点击控件',
      input: '填写字段',
      select: '选择选项',
      key: `按下 ${key ?? ''}`,
      scroll: '滚动页面',
      submit: '提交表单',
    };
    const anchor = element.closest('a[href]');
    let targetUrl: string | undefined;
    if (action === 'click' && anchor instanceof HTMLAnchorElement) {
      const url = new URL(anchor.href);
      if (!url.search && !url.hash && safeRecordingUrl(url.href) === url.origin + url.pathname) {
        targetUrl = safeRecordingUrl(url.href);
      }
    }
    const fact: RecordingFact = {
      id: crypto.randomUUID(),
      at: Date.now(),
      action,
      label: safeRecordingText(label || titles[action]),
      url: safeRecordingUrl(location.href),
      ...(targetUrl ? { targetUrl } : {}),
      role: (element.getAttribute('role') ?? element.tagName.toLowerCase()).slice(0, 40),
      ...(key ? { key } : {}),
      ...(['input', 'select'].includes(action) ? { redacted: true } : {}),
      ...(element instanceof HTMLInputElement ? { inputType: element.type } : {}),
    };
    const choice = ['click', 'input', 'change'].includes(event.type) ? readChoiceControl(element) : undefined;
    if (choice) {
      fact.label = choice.label;
      if (event.type === 'input' || event.type === 'change') {
        fact.action = 'select';
      }
      // A click can be cancelled or update asynchronously. Only native input/change proves a sampled state.
      fact.control = {
        ...choice,
        state:
          ['input', 'change'].includes(event.type) &&
          (element instanceof HTMLInputElement || element instanceof HTMLSelectElement)
            ? choice.state
            : null,
      };
    }
    let targetRef = this.targets.get(element);
    if (!targetRef) {
      targetRef = `control-${++this.nextTarget}`;
      this.targets.set(element, targetRef);
    }
    fact.targetRef = targetRef;
    if (action === 'input' || action === 'select') {
      let editRef = this.edits.get(element);
      if (!editRef) {
        editRef = crypto.randomUUID();
        this.edits.set(element, editRef);
      }
      fact.editRef = editRef;
      this.pending.set(element, fact);
      if (this.pending.size > 20) {
        this.flush();
      }
      if (this.timer) {
        clearTimeout(this.timer);
      }
      if (!this.composing) {
        this.timer = setTimeout(this.flush, 350);
      }
      if (event.type === 'change') {
        this.flush();
        this.edits.delete(element);
      }
    } else {
      this.flush();
      this.edits = new WeakMap();
      this.emit(fact);
    }
  };
}
