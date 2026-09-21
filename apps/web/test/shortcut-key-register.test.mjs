/**
 * @author Claude
 * @description Verifies the ShortcutKeyRegister dispatch loop: registration lifecycle, LIFO consumption, guards, override sync, and placeholder exclusion.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ShortcutKeyRegister } from '../src/lib/shortcuts/shortcut-key-register.ts';

const EDITABLE = { editable: true };

function createFakeTarget() {
  const listeners = new Map();
  return {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    },
    emit: (event) => listeners.get('keydown')?.(event),
    listening: () => listeners.has('keydown'),
  };
}

function keyEvent(init = {}) {
  return {
    key: 'b',
    code: 'KeyB',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    target: null,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...init,
  };
}

function createRegister() {
  const target = createFakeTarget();
  const register = new ShortcutKeyRegister({
    target,
    isEditableTarget: (eventTarget) => eventTarget === EDITABLE,
  });
  register.start();
  return { register, target };
}

test('start attaches and stop detaches the keydown listener idempotently', () => {
  const target = createFakeTarget();
  const register = new ShortcutKeyRegister({ target });
  assert.equal(target.listening(), false);
  register.start();
  register.start();
  assert.equal(target.listening(), true);
  register.stop();
  register.stop();
  assert.equal(target.listening(), false);
});

test('dispatches a matched global command and prevents the browser default', () => {
  const { register, target } = createRegister();
  const calls = [];
  register.register(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR, (event) => {
    calls.push(event);
    return true;
  });
  const event = keyEvent({ ctrlKey: true });
  target.emit(event);
  assert.equal(calls.length, 1);
  assert.equal(event.defaultPrevented, true);
});

test('the returned disposer removes exactly one registration', () => {
  const { register, target } = createRegister();
  const calls = [];
  const dispose = register.register(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR, () => {
    calls.push('first');
    return true;
  });
  dispose();
  dispose();
  const event = keyEvent({ ctrlKey: true });
  target.emit(event);
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
});

test('handlers run LIFO and the first true return consumes the event', () => {
  const { register, target } = createRegister();
  const calls = [];
  register.register(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR, () => {
    calls.push('registered-first');
    return true;
  });
  register.register(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR, () => {
    calls.push('registered-second');
  });
  target.emit(keyEvent({ ctrlKey: true }));
  assert.deepEqual(calls, ['registered-second', 'registered-first']);
});

test('a matched command without handlers does not prevent the browser default', () => {
  const { target } = createRegister();
  const event = keyEvent({ ctrlKey: true });
  target.emit(event);
  assert.equal(event.defaultPrevented, false);
});

test('ignores IME composition, key repeat, and suspended dispatch', () => {
  const { register, target } = createRegister();
  const calls = [];
  register.register(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR, () => {
    calls.push('hit');
    return true;
  });
  target.emit(keyEvent({ ctrlKey: true, isComposing: true }));
  target.emit(keyEvent({ ctrlKey: true, repeat: true }));
  register.setSuspended(true);
  target.emit(keyEvent({ ctrlKey: true }));
  register.setSuspended(false);
  target.emit(keyEvent({ ctrlKey: true }));
  assert.deepEqual(calls, ['hit']);
});

test('editable focus blocks weak combos but not strong-modifier or allowInEditable ones', () => {
  const { register, target } = createRegister();
  const calls = [];
  register.register(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR, () => {
    calls.push('sidebar');
    return true;
  });
  register.register(ShortcutKeyRegister.STOP_GENERATION, () => {
    calls.push('stop');
    return true;
  });
  register.register(ShortcutKeyRegister.NEW_SESSION, () => {
    calls.push('new');
    return true;
  });
  // Strong modifier (Ctrl+B) fires even inside editable targets.
  target.emit(keyEvent({ ctrlKey: true, target: EDITABLE }));
  // allowInEditable command (Shift+Esc) fires inside editable targets.
  target.emit(keyEvent({ key: 'Escape', code: 'Escape', shiftKey: true, target: EDITABLE }));
  // Weak combo (Alt removed via override to Shift+N) is blocked inside editable targets.
  register.syncOverrides({ 'session.new': 'Shift+N' });
  target.emit(keyEvent({ key: 'n', code: 'KeyN', shiftKey: true, target: EDITABLE }));
  // …but fires from a non-editable target.
  target.emit(keyEvent({ key: 'n', code: 'KeyN', shiftKey: true }));
  assert.deepEqual(calls, ['sidebar', 'stop', 'new']);
});

test('syncOverrides re-points dispatch to the user binding', () => {
  const { register, target } = createRegister();
  const calls = [];
  register.register(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR, () => {
    calls.push('sidebar');
    return true;
  });
  register.syncOverrides({ 'layout.toggleLeftSidebar': 'Ctrl+Shift+L' });
  target.emit(keyEvent({ ctrlKey: true }));
  target.emit(keyEvent({ key: 'l', code: 'KeyL', ctrlKey: true, shiftKey: true }));
  assert.deepEqual(calls, ['sidebar']);
});

test('a cleared binding (override null) disables dispatch', () => {
  const { register, target } = createRegister();
  const calls = [];
  register.register(ShortcutKeyRegister.NEW_SESSION, () => {
    calls.push('new');
    return true;
  });
  register.syncOverrides({ 'session.new': null });
  const event = keyEvent({ key: 'n', code: 'KeyN', altKey: true });
  target.emit(event);
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
});

test('placeholder commands never dispatch even with a handler registered', () => {
  const { register, target } = createRegister();
  const calls = [];
  register.register(ShortcutKeyRegister.VOICE_TOGGLE, () => {
    calls.push('voice');
    return true;
  });
  const event = keyEvent({ key: 'd', code: 'KeyD', ctrlKey: true });
  target.emit(event);
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
});

test('get/getCombo/list expose effective bindings and metadata', () => {
  const { register } = createRegister();
  assert.equal(register.getCombo(ShortcutKeyRegister.NEW_SESSION), 'Alt+N');
  register.syncOverrides({ 'session.new': null, 'layout.toggleLeftSidebar': 'Ctrl+Shift+L' });
  assert.equal(register.getCombo(ShortcutKeyRegister.NEW_SESSION), '');
  assert.equal(register.get(ShortcutKeyRegister.NEW_SESSION).binding, null);
  assert.equal(register.get(ShortcutKeyRegister.NEW_SESSION).defaultBinding, 'Alt+N');
  assert.equal(register.get(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR).binding, 'Ctrl+Shift+L');
  assert.equal(register.list().length, 10);
  assert.equal(register.get(ShortcutKeyRegister.VOICE_TOGGLE).status, 'placeholder');
  assert.throws(() => register.get('nope'));
});

test('matches tests events against effective composer bindings', () => {
  const { register } = createRegister();
  assert.equal(
    register.matches(ShortcutKeyRegister.SEND_MESSAGE, keyEvent({ key: 'Enter', code: 'Enter' })),
    true
  );
  assert.equal(
    register.matches(
      ShortcutKeyRegister.INSERT_NEWLINE,
      keyEvent({ key: 'Enter', code: 'Enter', shiftKey: true })
    ),
    true
  );
  register.syncOverrides({ 'composer.send': null });
  assert.equal(
    register.matches(ShortcutKeyRegister.SEND_MESSAGE, keyEvent({ key: 'Enter', code: 'Enter' })),
    false
  );
});
