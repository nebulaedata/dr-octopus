/**
 * @author Codex
 * @description Verify model curation binds trusted evidence before validation and never persists invented source identities.
 */
import assert from 'node:assert/strict';
import { stopMemoryService } from '../dist/extensions/memory/sdk/lifecycle.js';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPiMemoryCurator } from '../dist/extensions/memory/lib/curator.js';
import { createMemoryService } from '../dist/extensions/memory/sdk/index.js';

const source = { sessionId: 'session', entryId: 'entry', evidence: 'Always use concise Chinese replies.' };

/**
 * Return a model candidate with independently controlled source references.
 */
function candidate(sources) {
  return {
    requestId: 'placeholder',
    action: 'create',
    canonicalKey: 'preferences.language',
    topic: 'Preferences',
    type: 'preference',
    indexText: 'Use concise Chinese replies',
    bodyMd: 'Always use concise Chinese replies.',
    sources,
  };
}

/**
 * Exercise the real model-output adapter with a deterministic provider response.
 */
function curator(output) {
  return createPiMemoryCurator({
    model: { id: 'fixture' },
    modelRegistry: {
      complete: async () => ({
        stopReason: 'stop',
        content: [{ type: 'text', text: JSON.stringify(output) }],
      }),
    },
  });
}

/**
 * Keep persistence and write fences real while isolating all test data.
 */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'memory-curator-'));
  const service = createMemoryService({ dataRoot: root });
  await service.initialize();
  t.after(async () => {
    await service.dispose();
    await stopMemoryService(root);
    await rm(root, { recursive: true, force: true });
  });
  return service;
}

for (const evidence of [undefined, 'Invented evidence from the model']) {
  test(
    'curation persists original evidence when the model ' + (evidence ? 'rewrites it' : 'omits it'),
    async (t) => {
      const service = await fixture(t);
      const ref = { sessionId: source.sessionId, entryId: source.entryId, ...(evidence ? { evidence } : {}) };
      const receipts = await service.evaluateRun(
        [source],
        curator([candidate([ref])]),
        new AbortController().signal
      );
      assert.equal(receipts.length, 1);
      const document = (await service.read({ refs: [receipts[0].ref] })).items[0].document;
      assert.deepEqual(document.sources, [source]);
      assert.equal(document.bodyMd, 'Always use concise Chinese replies.');
    }
  );
}

test('curation rejects missing, fabricated, or ambiguous source identities without partial commits', async (t) => {
  const service = await fixture(t);
  for (const sources of [
    undefined,
    [],
    [{ sessionId: 'session', entryId: 'invented' }],
    [{ sessionId: 'other-session', entryId: 'entry' }],
    [{ sessionId: 'session:entry', entryId: 'extra' }],
    [{ sessionId: 'session' }],
  ]) {
    await assert.rejects(
      service.evaluateRun(
        [source],
        curator([candidate([source]), candidate(sources)]),
        new AbortController().signal
      )
    );
    assert.equal((await service.getStatus()).count, 0);
  }
});

test('curation preserves fact validation, batch limits and cancellation fences', async (t) => {
  const service = await fixture(t);
  for (const output of [
    { unexpected: true },
    Array.from({ length: 6 }, () => candidate([source])),
    [{ ...candidate([source]), bodyMd: '' }],
    [{ ...candidate([source]), unexpected: 'field' }],
  ]) {
    await assert.rejects(service.evaluateRun([source], curator(output), new AbortController().signal));
  }
  const controller = new AbortController();
  const lateCurator = curator([candidate([{ sessionId: source.sessionId, entryId: source.entryId }])]);
  await assert.rejects(
    service.evaluateRun(
      [source],
      async (input, signal) => {
        const output = await lateCurator(input, signal);
        controller.abort();
        return output;
      },
      controller.signal
    ),
    { name: 'AbortError' }
  );
  assert.equal((await service.getStatus()).count, 0);
});

for (const malformed of ['[]\n\n---SOURCE_COPY---\n{}', 'missing-target']) {
  test('curation repairs ' + malformed + ' with one bounded request before committing', async (t) => {
    const service = await fixture(t);
    const created = await service.remember(candidate([source]));
    const existing = (await service.read({ refs: [created.ref] })).items[0].document;
    const correctedSource = {
      ...source,
      entryId: 'correction',
      evidence: 'Use Chinese date format YYYY-MM-DD.',
    };
    const update = {
      ...candidate([correctedSource]),
      action: 'update',
      target: created.ref,
      expectedRevision: existing.revision,
      bodyMd: correctedSource.evidence,
    };
    const requests = [];
    const repair = createPiMemoryCurator({
      model: { id: 'fixture' },
      modelRegistry: {
        complete: async (_model, context, options) => {
          requests.push({ context, options });
          const first =
            malformed === 'missing-target'
              ? JSON.stringify([{ ...update, target: undefined, expectedRevision: undefined }])
              : malformed;
          return {
            stopReason: 'stop',
            content: [{ type: 'text', text: requests.length === 1 ? first : JSON.stringify([update]) }],
          };
        },
      },
    });
    const signal = new AbortController().signal;
    const proposed = await repair({ sources: [correctedSource], existing: [existing] }, signal);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((r) => r.options.signal === signal));
    assert.match(requests[1].context.systemPrompt, /Every non-create action MUST include target/);
    await service.remember({ ...proposed[0], requestId: 'corrected' });
    assert.equal(
      (await service.read({ refs: [created.ref] })).items[0].document.bodyMd,
      correctedSource.evidence
    );
    await assert.rejects(
      repair({ sources: [correctedSource], existing: [existing] }, signal),
      /budget exhausted/
    );
    assert.equal(requests.length, 2, 'format repair and conflict reassessment share one model call budget');
  });
}
