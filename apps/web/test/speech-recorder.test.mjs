/**
 * @author Codex
 * @description Verifies capture finalization, cancellation, late permissions, limits and resource release.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SpeechRecorder } from '../src/features/session/utils/speech-recorder.ts';

/**
 * Installs deterministic browser recording resources for one test.
 */
function fixture(t, { delayed = false } = {}) {
  let stopped = 0;
  let allow;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const original = ['navigator', 'isSecureContext', 'MediaRecorder'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  class Recorder {
    static latest;
    static isTypeSupported() {
      return true;
    }
    constructor(_stream, { mimeType }) {
      Recorder.latest = this;
      this.mimeType = mimeType;
      this.state = 'inactive';
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['final-audio']) });
        this.onstop?.();
      });
    }
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () =>
          delayed
            ? new Promise((resolve) => {
                allow = () => resolve(stream);
              })
            : Promise.resolve(stream),
      },
    },
  });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    get stopped() {
      return stopped;
    },
    get recorder() {
      return Recorder.latest;
    },
    allow: () => allow(),
  };
}

test('recording waits for final chunk and releases microphone', async (t) => {
  const env = fixture(t);
  const owner = new SpeechRecorder();
  const result = owner.record(() => owner.stop());
  assert.equal(await (await result).text(), 'final-audio');
  assert.ok(env.stopped > 0);
  assert.equal(env.recorder.onstop, null);
});

test('cancellation discards audio and closes a permission grant arriving later', async (t) => {
  const env = fixture(t, { delayed: true });
  const owner = new SpeechRecorder();
  const result = owner.record(() => assert.fail('must not start after cancellation'));
  owner.cancel();
  env.allow();
  assert.equal(await result, null);
  assert.ok(env.stopped > 0);
});

test('cancellation during recording never resolves an uploadable Blob', async (t) => {
  const env = fixture(t);
  const owner = new SpeechRecorder();
  const result = owner.record(() => owner.cancel());
  assert.equal(await result, null);
  assert.ok(env.stopped > 0);
});

test('oversized recording rejects and releases the device', async (t) => {
  const env = fixture(t);
  const owner = new SpeechRecorder();
  await assert.rejects(
    owner.record(() =>
      env.recorder.ondataavailable({ data: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) })
    ),
    /too-large/
  );
  assert.ok(env.stopped > 0);
});
