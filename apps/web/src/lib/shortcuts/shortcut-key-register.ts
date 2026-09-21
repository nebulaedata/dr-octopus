/**
 * @author Claude
 * @description Owns the single window keydown listener that dispatches global-scope shortcut commands to registered handlers, applying guards (IME, repeat, suspended, editable focus) before consumption.
 */

import { comboHasStrongModifier, comboMatches, normalizeEvent } from './shortcut-combo';
import { resolveEffectiveBinding, SHORTCUT_CATALOG } from './shortcut-catalog';
import type {
  ShortcutBindingOverrides,
  ShortcutCommandId,
  ShortcutScope,
  ShortcutStatus,
} from './shortcut-catalog';

/**
 * Handles a dispatched shortcut; return true to consume the event in LIFO order.
 */
export type ShortcutHandler = (event: KeyboardEvent) => boolean | void;

export interface ShortcutCommandView {
  id: ShortcutCommandId;
  scope: ShortcutScope;
  status: ShortcutStatus;
  defaultBinding: string | null;
  /** Binding currently in effect (override wins over default); null when the user cleared it. */
  binding: string | null;
}

export interface ShortcutKeyRegisterOptions {
  /** Event source; defaults to window. Tests inject a fake target. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Editable-focus predicate; defaults to input/textarea/select/contenteditable detection. */
  isEditableTarget?: (target: EventTarget | null) => boolean;
}

/**
 * Default editable-focus guard: keydown inside form fields or contenteditable regions.
 *
 * @param target Event target.
 * @returns True when the gesture is probably text entry.
 */
function defaultIsEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Global shortcut registry: command metadata, effective bindings, handler stacks, and the window keydown dispatch loop.
 */
export class ShortcutKeyRegister {
  static readonly VOICE_TOGGLE = 'voice.toggle' as const;
  static readonly FOCUS_COMPOSER = 'composer.focus' as const;
  static readonly SEND_MESSAGE = 'composer.send' as const;
  static readonly INSERT_NEWLINE = 'composer.newline' as const;
  static readonly STOP_GENERATION = 'session.stop' as const;
  static readonly PREVIOUS_SESSION = 'session.previous' as const;
  static readonly NEXT_SESSION = 'session.next' as const;
  static readonly NEW_SESSION = 'session.new' as const;
  static readonly TOGGLE_LEFT_SIDEBAR = 'layout.toggleLeftSidebar' as const;
  static readonly TOGGLE_RIGHT_PANEL = 'layout.toggleRightPanel' as const;

  readonly #target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly #isEditableTarget: (target: EventTarget | null) => boolean;
  readonly #handlers = new Map<ShortcutCommandId, ShortcutHandler[]>();
  #overrides: ShortcutBindingOverrides = {};
  #suspended = false;
  #started = false;

  /**
   * Creates a registry; call `start()` to attach the window listener.
   *
   * @param options Optional event target and editable-focus predicate overrides for tests.
   */
  constructor(options: ShortcutKeyRegisterOptions = {}) {
    this.#target = options.target ?? (typeof window === 'undefined' ? undefined : window);
    this.#isEditableTarget = options.isEditableTarget ?? defaultIsEditableTarget;
  }

  /**
   * Attaches the keydown listener to the target; idempotent.
   */
  start(): void {
    if (this.#started || this.#target === undefined) {
      return;
    }
    this.#target.addEventListener('keydown', this.#onKeydown);
    this.#started = true;
  }

  /**
   * Detaches the keydown listener; registered handlers survive and dispatch resumes on the next `start()`.
   */
  stop(): void {
    if (!this.#started || this.#target === undefined) {
      return;
    }
    this.#target.removeEventListener('keydown', this.#onKeydown);
    this.#started = false;
  }

  /**
   * Registers a command handler on top of its stack.
   *
   * @param commandId Command ID (use the static constants, e.g. `ShortcutKeyRegister.NEW_SESSION`).
   * @param handler Callback; returning true stops LIFO traversal.
   * @returns Disposer that removes exactly this registration.
   */
  register(commandId: ShortcutCommandId, handler: ShortcutHandler): () => void {
    const handlers = this.#handlers.get(commandId) ?? [];
    handlers.push(handler);
    this.#handlers.set(commandId, handlers);
    return () => {
      const current = this.#handlers.get(commandId);
      if (current === undefined) {
        return;
      }
      const next = current.filter((candidate) => candidate !== handler);
      if (next.length === 0) {
        this.#handlers.delete(commandId);
      } else {
        this.#handlers.set(commandId, next);
      }
    };
  }

  /**
   * Reads the full view of one command including its effective binding.
   *
   * @param commandId Command ID.
   * @returns Command metadata snapshot.
   */
  get(commandId: ShortcutCommandId): ShortcutCommandView {
    const definition = SHORTCUT_CATALOG.find((candidate) => candidate.id === commandId);
    if (definition === undefined) {
      throw new Error(`Unknown shortcut command: ${commandId}`);
    }
    return {
      id: definition.id,
      scope: definition.scope,
      status: definition.status,
      defaultBinding: definition.defaultBinding,
      binding: resolveEffectiveBinding(this.#overrides, commandId),
    };
  }

  /**
   * Reads the effective binding as display text.
   *
   * @param commandId Command ID.
   * @returns Combo such as `Ctrl+Shift+B`, or an empty string when unbound.
   */
  getCombo(commandId: ShortcutCommandId): string {
    return this.get(commandId).binding ?? '';
  }

  /**
   * Lists every command in catalog order.
   *
   * @returns Command metadata snapshots including placeholders.
   */
  list(): ShortcutCommandView[] {
    return SHORTCUT_CATALOG.map((definition) => this.get(definition.id));
  }

  /**
   * Tests an event against one command's effective binding; used by the Lexical plugin for composer-scope commands.
   *
   * @param commandId Command ID.
   * @param event Keyboard event to test.
   * @returns True when the command is bound and the event matches.
   */
  matches(commandId: ShortcutCommandId, event: KeyboardEvent): boolean {
    const binding = this.get(commandId).binding;
    return binding !== null && comboMatches(event, binding);
  }

  /**
   * Replaces the override snapshot; called by the store wiring whenever persisted bindings change.
   *
   * @param overrides Latest user overrides.
   */
  syncOverrides(overrides: ShortcutBindingOverrides): void {
    this.#overrides = { ...overrides };
  }

  /**
   * Pauses/resumes global dispatch while the settings recorder captures the next keystroke.
   *
   * @param suspended True to ignore all keydown events.
   */
  setSuspended(suspended: boolean): void {
    this.#suspended = suspended;
  }

  readonly #onKeydown = (event: KeyboardEvent): void => {
    if (this.#suspended || event.isComposing || event.repeat) {
      return;
    }
    const combo = normalizeEvent(event);
    if (combo === null) {
      return;
    }
    const command = SHORTCUT_CATALOG.find(
      (definition) =>
        definition.scope === 'global' &&
        definition.status === 'active' &&
        resolveEffectiveBinding(this.#overrides, definition.id) === combo
    );
    if (command === undefined) {
      return;
    }
    const handlers = this.#handlers.get(command.id);
    if (handlers === undefined || handlers.length === 0) {
      return;
    }
    if (
      this.#isEditableTarget(event.target) &&
      command.allowInEditable !== true &&
      !comboHasStrongModifier(combo)
    ) {
      return;
    }
    event.preventDefault();
    for (let index = handlers.length - 1; index >= 0; index -= 1) {
      if (handlers[index](event) === true) {
        break;
      }
    }
  };
}
