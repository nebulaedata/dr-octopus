/**
 * @author Codex
 * @description Checks transport diagnostics without network calls or paid models, including redaction and cancellation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { traceProviderFetch } from './integration/provider-probe-trace.mjs';

test('trace separates headers/body and excludes secret headers, prompts and response text', async () => {
  const events = [];
  const init = {
    headers: { Authorization: 'Bearer SECRET' },
    body: JSON.stringify({
      model: 'PRIVATE-MODEL',
      messages: [{ content: 'PRIVATE-PROMPT' }],
      response_format: { type: 'json_object' },
      enable_thinking: false,
      max_tokens: 12000,
    }),
  };
  const response = await traceProviderFetch(
    async (_url, received) => {
      assert.equal(received, init);
      return new Response('PRIVATE-RESPONSE', { status: 200, headers: { 'x-private': 'SECRET' } });
    },
    async (entry) => events.push(entry)
  )('https://private.example', init);
  assert.equal(await response.text(), 'PRIVATE-RESPONSE');
  assert.deepEqual(
    events.map((event) => event.phase),
    ['request', 'headers', 'first-byte', 'body-complete']
  );
  assert.equal(events[0].thinkingDisabled, true);
  assert.equal(events[1].httpStatus, 200);
  assert.equal(events.at(-1).responseBytes, 16);
  assert.equal(/SECRET|PRIVATE|private.example/.test(JSON.stringify(events)), false);
});

test('failure before headers is distinguished from failure during response body', async () => {
  const early = [];
  const timeout = new DOMException('synthetic', 'TimeoutError');
  await assert.rejects(
    traceProviderFetch(
      async () => {
        throw timeout;
      },
      async (entry) => early.push(entry)
    )('https://example.com'),
    (error) => error === timeout
  );
  assert.deepEqual(
    early.map((event) => event.phase),
    ['request', 'request-error']
  );
  const late = [];
  const response = await traceProviderFetch(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(timeout);
          },
        })
      ),
    async (entry) => late.push(entry)
  )('https://example.com');
  await assert.rejects(response.text(), (error) => error === timeout);
  assert.deepEqual(
    late.map((event) => event.phase),
    ['request', 'headers', 'body-error']
  );
});

test('body cancellation reaches original stream without reading ahead', async () => {
  let cancelled = false;
  const response = await traceProviderFetch(
    async () =>
      new Response(
        new ReadableStream(
          {
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 }
        )
      ),
    async () => {}
  )('https://example.com');
  await response.body.cancel();
  assert.equal(cancelled, true);
});
