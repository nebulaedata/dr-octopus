/**
 * @author Codex
 * @description Covers delayed npm metadata and tarballs, bounded retries and permanent publication errors.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForNpmVersion } from '../npm-ready.mjs';

const tarball = 'https://registry.npmjs.org/dr-octopus/-/dr-octopus-1.2.3.tgz';

/**
 * Models a registry response sequence and a virtual clock without real network requests or sleeps.
 */
function registry(sequence) {
  let time = 0;
  const calls = [];
  const pauses = [];
  return {
    calls,
    pauses,
    options: {
      timeoutMs: 180_000,
      intervalMs: 60_000,
      now: () => time,
      log: () => {},
      pause: async (duration) => {
        pauses.push(duration);
        time += duration;
      },
      request: async (url, options) => {
        calls.push({ url, method: options.method });
        const item = sequence.shift();
        assert.notEqual(item, undefined, 'Unexpected extra registry request');
        if (item instanceof Error) throw item;
        if (item instanceof Response) return item;
        if (typeof item === 'number') return new Response(null, { status: item });
        return new Response(JSON.stringify(item));
      },
    },
  };
}

const metadata = { name: 'dr-octopus', version: '1.2.3', dist: { tarball } };

test('waits for both metadata and tarball visibility before allowing a build', async () => {
  const state = registry([404, metadata, 404, metadata, 200]);
  await waitForNpmVersion('1.2.3', state.options);
  assert.deepEqual(state.pauses, [60_000, 60_000]);
  assert.deepEqual(state.calls.at(-1), { url: tarball, method: 'HEAD' });
});

test('a visible exact version proceeds immediately', async () => {
  const state = registry([metadata, 200]);
  await waitForNpmVersion('1.2.3', state.options);
  assert.deepEqual(state.pauses, []);
  assert.match(state.calls[0].url, /\/dr-octopus\/1\.2\.3$/);
});

test('temporary registry failures retry within the deadline and explain manual recovery', async () => {
  for (const failure of [404, 429, 503, new Error('offline')]) {
    const state = registry([failure, failure, failure]);
    await assert.rejects(waitForNpmVersion('1.2.3', state.options), /re-run the failed Actions job/);
    assert.equal(state.calls.length, 3);
    assert.deepEqual(state.pauses, [60_000, 60_000, 60_000]);
  }
});

/**
 * Returns successful headers whose body fails while being consumed, as with a dropped connection or timeout.
 */
function interruptedResponse(error) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"name":'));
      },
      pull(controller) {
        controller.error(error);
      },
    })
  );
}

test('retries interrupted or timed-out metadata bodies before checking the tarball', async () => {
  for (const failure of [
    new TypeError('terminated'),
    new DOMException('Request timed out', 'TimeoutError'),
    new DOMException('Request aborted', 'AbortError'),
  ]) {
    const state = registry([interruptedResponse(failure), metadata, 200]);
    await waitForNpmVersion('1.2.3', state.options);
    assert.deepEqual(state.pauses, [60_000]);
    assert.deepEqual(
      state.calls.map(({ method }) => method),
      ['GET', 'GET', 'HEAD']
    );
  }
});

test('metadata body failures stop at the deadline without another request or sleep', async () => {
  let time = 0;
  let calls = 0;
  await assert.rejects(
    waitForNpmVersion('1.2.3', {
      timeoutMs: 1000,
      now: () => time,
      log: () => {},
      request: async () => {
        calls++;
        return new Response(
          new ReadableStream({
            pull(controller) {
              time = 1000;
              controller.error(new DOMException('Request timed out', 'TimeoutError'));
            },
          })
        );
      },
      pause: async () => assert.fail('Deadline has already expired'),
    }),
    /not publicly downloadable/
  );
  assert.equal(calls, 1);
});

test('request time counts toward the deadline', async () => {
  let time = 0;
  let calls = 0;
  await assert.rejects(
    waitForNpmVersion('1.2.3', {
      timeoutMs: 1000,
      now: () => time,
      log: () => {},
      request: async () => {
        calls++;
        time += 1000;
        return new Response(null, { status: 404 });
      },
      pause: async () => assert.fail('Deadline has already expired'),
    }),
    /not publicly downloadable/
  );
  assert.equal(calls, 1);
});

test('permanent errors and invalid metadata stop immediately', async () => {
  for (const result of [
    401,
    403,
    new Response('{invalid json'),
    { ...metadata, version: '1.2.2' },
    { ...metadata, name: 'another-package' },
    { ...metadata, dist: { tarball: 'https://example.com/package.tgz' } },
  ]) {
    const state = registry([result]);
    await assert.rejects(waitForNpmVersion('1.2.3', state.options));
    assert.deepEqual(state.pauses, []);
    assert.equal(state.calls.length, 1);
  }
  await assert.rejects(waitForNpmVersion('latest', registry([]).options));
});
