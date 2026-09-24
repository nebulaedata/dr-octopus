/**
 * @author Codex
 * @description Covers clipboard availability, rejected permissions, and legacy cleanup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { copyText } from "../src/utils/clipboard.ts";

/**
 * Installs a minimal browser surface and records the legacy copy lifecycle.
 */
function setup(t, clipboard, result = true) {
  const calls = [];
  class Element {
    focus() {
      calls.push('focus');
    }
  }
  class Input extends Element {}
  const active = new Element();
  const textarea = {
    style: {},
    focus() {},
    select() {
      calls.push(['select', this.value]);
    },
    remove() {
      calls.push('remove');
    },
  };
  const globals = {
    navigator: { clipboard },
    HTMLElement: Element,
    HTMLInputElement: Input,
    HTMLTextAreaElement: Input,
    document: {
      activeElement: active,
      getSelection: () => null,
      createElement: () => textarea,
      body: {
        appendChild() {
          calls.push('append');
        },
      },
      execCommand(command) {
        calls.push(command);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  return calls;
}

test('uses the Clipboard API without creating a temporary element', async (t) => {
  let written;
  const calls = setup(t, {
    async writeText(text) {
      written = text;
    },
  });
  await copyText('智能体\nmessage');
  assert.equal(written, '智能体\nmessage');
  assert.deepEqual(calls, []);
});

test('copies when navigator.clipboard is undefined and restores focus', async (t) => {
  const calls = setup(t, undefined);
  await copyText('智能体\nmessage');
  assert.deepEqual(calls, ['append', ['select', '智能体\nmessage'], 'copy', 'remove', 'focus']);
});

test('falls back after Clipboard API permission rejection', async (t) => {
  const calls = setup(t, {
    async writeText() {
      throw new Error('NotAllowedError');
    },
  });
  await copyText('message');
  assert.ok(calls.includes('copy'));
});

for (const result of [false, new Error('Copy blocked')]) {
  test(`rejects failed legacy copy and cleans up (${result})`, async (t) => {
    const calls = setup(t, undefined, result);
    await assert.rejects(copyText('message'));
    assert.deepEqual(calls.slice(-2), ['remove', 'focus']);
  });
}
