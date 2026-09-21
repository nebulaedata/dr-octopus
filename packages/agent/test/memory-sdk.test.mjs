/**
 * @author Codex
 * @description Verify memory across complete Pi runs, model tool loops and independent workspaces.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { memorySdkFixture } from './fixtures/memory-sdk-fixture.mjs';

/**
 * Extract actual curation requests from the HTTP provider boundary.
 */
function curationRequests(f) {
  return f.requests.filter((r) =>
    r.messages.some((m) => String(m.content).includes('You curate global long-term memory.'))
  );
}

test('real Pi injects the skill, commits the first user request and recalls it in another workspace', async (t) => {
  const f = await memorySdkFixture(t);
  const a = await f.open();
  await a.prompt('记住：QA_MEMORY 我偏好中文和简短回答。');
  assert.equal((await f.service.getStatus()).count, 1);
  assert.equal(curationRequests(f).length, 1);
  const policy = f.requests[0].messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => m.content)
    .join('\n');
  assert.match(policy, /at most twice/);
  assert.match(policy, /host reports committed saves separately/);
  assert.doesNotMatch(policy, /skills[\\/]memory[\\/]SKILL\.md/);
  assert.ok(
    a.messages.some((m) => m.customType === 'octopus-memory-operation' && m.content.includes('已保存 1 条'))
  );
  const b = await f.open();
  assert.notEqual(a.sessionId, b.sessionId);
  await b.prompt('RECALL_MEMORY 查阅我的测试偏好。');
  const results = b.messages.filter((m) => m.role === 'toolResult');
  assert.deepEqual(
    results.map((m) => m.toolName),
    ['memory_recall', 'memory_read']
  );
  assert.match(JSON.stringify(results.at(-1).content), /中文和简短回答/);
  assert.ok(results.every((m) => !m.isError));
  assert.deepEqual(f.errors, []);
});

test('manual mode saves only explicit requests and off mode suppresses context and curation', async (t) => {
  const f = await memorySdkFixture(t);
  const session = await f.open();
  await session.prompt('/memory mode manual');
  await session.prompt('QA_MEMORY 我的回答偏好是中文。');
  assert.equal((await f.service.getStatus()).count, 0);
  assert.equal(curationRequests(f).length, 0);
  await session.prompt('记住：QA_MEMORY 我的回答偏好是中文。');
  assert.equal((await f.service.getStatus()).count, 1);
  assert.equal(curationRequests(f).length, 1);
  await session.prompt('/memory mode off');
  await session.prompt('记住：QA_MEMORY 改成使用英文。');
  assert.equal(curationRequests(f).length, 1);
  const last = f.requests.at(-1);
  assert.ok(!last.messages.some((m) => String(m.content).includes('Historical navigation only.')));
  const docs = await f.service.recall({ mode: 'page' });
  assert.equal(docs.items.length, 1);
  const read = await f.service.read({
    refs: docs.items.map(({ storeId, indexId }) => ({ storeId, indexId })),
  });
  assert.match(read.items[0].document.bodyMd, /中文/);
  assert.deepEqual(f.errors, []);
});

test('read-only and untrusted real sessions cannot curate; successful ordinary tasks do not add facts', async (t) => {
  const f = await memorySdkFixture(t);
  const normal = await f.open({ mode: 'tui' });
  await normal.prompt('今天只是临时查询天气。');
  assert.equal((await f.service.getStatus()).count, 0);
  const before = curationRequests(f).length;
  for (const options of [{ readOnly: true }, { trusted: false }]) {
    const session = await f.open(options);
    await session.prompt('记住：QA_MEMORY 我偏好中文。');
    assert.equal((await f.service.getStatus()).count, 0);
    assert.equal(curationRequests(f).length, before);
  }
  assert.deepEqual(f.errors, []);
});

test('provider failure and invalid curator output never produce a committed save receipt', async (t) => {
  const f = await memorySdkFixture(t);
  const session = await f.open();
  await session.prompt('FAIL_MAIN 记住：QA_MEMORY 我偏好中文。');
  assert.equal((await f.service.getStatus()).count, 0);
  assert.equal(curationRequests(f).length, 0);
  f.setCuratorOutput('invalid JSON');
  await session.prompt('记住：QA_MEMORY 我偏好中文。');
  assert.equal((await f.service.getStatus()).count, 0);
  assert.ok(f.states.some((s) => s.value?.includes('CURATION_FAILED')));
  assert.ok(!session.messages.some((m) => m.customType === 'octopus-memory-operation'));
});

test('real Pi repairs one malformed model response and publishes only the committed save', async (t) => {
  const f = await memorySdkFixture(t);
  f.setCuratorOutput(['[]\n\n---SOURCE_COPY---\n{}']);
  const session = await f.open();
  await session.prompt('记住：QA_MEMORY 我偏好中文。');
  assert.equal(curationRequests(f).length, 2);
  assert.equal((await f.service.getStatus()).count, 1);
  assert.equal(session.messages.filter((m) => m.customType === 'octopus-memory-operation').length, 1);
  assert.ok(f.states.some((s) => s.value?.includes('committed')));
  assert.ok(!f.states.some((s) => s.value?.includes('CURATION_FAILED')));
  assert.deepEqual(f.errors, []);
});

test('real Pi updates a remembered preference and invalidates historical tool results after forgetting', async (t) => {
  const f = await memorySdkFixture(t);
  const a = await f.open();
  await a.prompt('记住：QA_MEMORY 日期格式使用 YYYY/MM/DD。');
  await a.prompt('记住：QA_MEMORY 日期格式改为 YYYY-MM-DD。');
  const directory = await f.service.recall({ mode: 'page' });
  assert.equal(directory.items.length, 1);
  assert.equal(directory.items[0].revision, 2);
  const ref = { storeId: directory.items[0].storeId, indexId: directory.items[0].indexId };
  const b = await f.open();
  await b.prompt('RECALL_MEMORY 查阅日期格式。');
  assert.match(JSON.stringify(b.messages.findLast((m) => m.role === 'toolResult').content), /YYYY-MM-DD/);
  await a.prompt('/memory forget ' + ref.storeId + '/' + ref.indexId);
  assert.equal((await f.service.getStatus()).count, 0);
  await b.prompt('RECALL_MEMORY 再次查阅日期格式。');
  const request = f.requests.findLast((r) => r.messages.some((m) => m.role === 'tool'));
  assert.ok(request.messages.some((m) => m.role === 'tool' && String(m.content).includes('已删除或已替代')));
  assert.ok(!b.messages.some((m) => m.role === 'toolResult' && m.toolName === 'read'));
  assert.equal((await f.service.getStatus()).count, 0);
  assert.deepEqual(f.errors, []);
});

for (const mode of ['tui', 'rpc']) {
  test(mode + ' explicit commands save, list, read and forget without invoking a model', async (t) => {
    const f = await memorySdkFixture(t);
    const session = await f.open({ mode });
    await session.prompt('/memory remember QA_COMMAND 使用中文说明');
    assert.equal((await f.service.getStatus()).count, 1);
    const receipt = JSON.parse(
      session.messages.findLast((m) => m.customType === 'octopus-memory-command').content
    );
    await session.prompt('/memory list');
    await session.prompt('/memory read ' + receipt.ref.storeId + '/' + receipt.ref.indexId);
    assert.match(
      session.messages.findLast((m) => m.customType === 'octopus-memory-command').content,
      /使用中文说明/
    );
    await session.prompt('/memory forget ' + receipt.ref.storeId + '/' + receipt.ref.indexId);
    assert.equal((await f.service.getStatus()).count, 0);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.errors, []);
  });
}
