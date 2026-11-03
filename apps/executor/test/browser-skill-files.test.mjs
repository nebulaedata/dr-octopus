/**
 * @author Codex
 * @description Exercises real native file boundaries and idempotent browser skill publication in isolated project directories.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, readFile, access, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { NativeFileCommit } from '../src/runtime/basic/native-file-commit.ts';
import { BrowserSkillFiles } from '../src/runtime/browser/browser-skill-files.ts';

const candidate = {
  skillMarkdown:
    '---\nname: "订单查询：客户服务"\ndescription: |\n  按编号查询订单。\n---\nQuery {{orderNo}} and report the visible status.',
  workflow: {
    schemaVersion: 1,
    inputs: [{ name: 'orderNo', label: '订单编号', type: 'text', required: true }],
    allowedOrigins: ['https://orders.example.com'],
    pages: [{ role: 'search', startUrl: 'https://orders.example.com/search' }],
    execution: { maxModelCalls: 20 },
    evidence: [],
  },
};

/**
 * Uses the existing pinned native binary with disposable fixtures, never the user's configured skill library.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'octopus-browser-skills-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../dist/native/file-commit.node', import.meta.url))
  );
  return {
    root,
    files: new BrowserSkillFiles(native, root),
    installationId: randomUUID(),
    operationId: randomUUID(),
  };
}

test('skill deletion removes edited definitions, is idempotent and isolates other installations and skills', async () => {
  const { files, installationId, operationId } = await fixture();
  await files.create(installationId, operationId, candidate);
  const other = randomUUID();
  await files.create(installationId, other, candidate);
  const directory = await files.directoryPath(installationId, operationId);
  await writeFile(join(directory, 'SKILL.md'), 'user edited text');
  await files.remove(randomUUID(), operationId);
  await access(directory);
  assert.deepEqual(await files.remove(installationId, operationId), { deleted: true });
  await assert.rejects(access(directory), { code: 'ENOENT' });
  assert.deepEqual(await files.remove(installationId, operationId), { deleted: true });
  assert.equal((await files.read(installationId, other)).skillId, other);
  await assert.rejects(files.remove(installationId, '../outside'));
});

test('skill deletion refuses extra files and junctions without deleting their targets', async () => {
  const { root, files, installationId, operationId } = await fixture();
  await files.create(installationId, operationId, candidate);
  const directory = await files.directoryPath(installationId, operationId);
  await writeFile(join(directory, 'notes.txt'), 'keep');
  await assert.rejects(files.remove(installationId, operationId), /SKILL_STORAGE/);
  assert.equal((await files.read(installationId, operationId)).skillId, operationId);
  await unlink(join(directory, 'notes.txt'));
  const target = join(root, 'outside');
  await mkdir(target);
  await writeFile(join(target, 'keep.txt'), 'keep');
  await symlink(target, join(directory, 'link'), 'junction');
  await assert.rejects(files.remove(installationId, operationId), /SKILL_STORAGE/);
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'keep');
  const linkedId = randomUUID();
  await symlink(target, join(root, 'skills', 'browser-recordings', installationId, linkedId), 'junction');
  await assert.rejects(files.remove(installationId, linkedId), /SKILL_STORAGE/);
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'keep');
});

test('skill deletion clears partial staging files after an interrupted publication', async () => {
  const { root, files, installationId, operationId } = await fixture();
  await files.create(installationId, randomUUID(), candidate);
  const staging = join(root, 'skills', 'browser-recordings', installationId, '.' + operationId + '.pending');
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../dist/native/file-commit.node', import.meta.url))
  );
  assert.equal((await native.createSkillDirectory(staging)).ok, true);
  await writeFile(join(staging, 'SKILL.md'), 'partial');
  await files.remove(installationId, operationId);
  await assert.rejects(access(staging), { code: 'ENOENT' });
});

test('skill publication is idempotent and a manual edit changes the read snapshot without rewriting the receipt', async () => {
  const { root, files, installationId, operationId } = await fixture();
  const first = await files.create(installationId, operationId, candidate);
  const second = await files.create(installationId, operationId, candidate);
  assert.deepEqual(first, second);
  const before = await files.read(installationId, first.skillId);
  const directory = await files.directoryPath(installationId, first.skillId);
  assert.equal(directory, join(root, 'skills', 'browser-recordings', installationId, operationId));
  const edited = candidate.skillMarkdown + '\nReport only, do not change order status.';
  await writeFile(join(directory, 'SKILL.md'), edited);
  const after = await files.read(installationId, first.skillId);
  assert.notEqual(after.definitionHash, before.definitionHash);
  assert.equal(after.candidate.skillMarkdown, edited);
  assert.deepEqual(await files.receipt(installationId, operationId), first);
  await files.create(installationId, operationId, candidate);
  assert.equal(await readFile(join(directory, 'SKILL.md'), 'utf8'), edited);
  await assert.rejects(
    files.create(installationId, operationId, { ...candidate, skillMarkdown: edited }),
    /SKILL_CONFLICT/
  );
});

test('new operation creates a separate skill and one installation cannot read another installation directory', async () => {
  const { files, installationId, operationId } = await fixture();
  const first = await files.create(installationId, operationId, candidate);
  const second = await files.create(installationId, randomUUID(), candidate);
  assert.notEqual(first.skillId, second.skillId);
  await assert.rejects(files.read(randomUUID(), first.skillId), /SKILL_MISSING/);
  await assert.rejects(files.read(installationId, '../outside'));
  assert.equal(await files.receipt(installationId, randomUUID()), null);
});

test('choice requirements survive native save/read and manual JSON edits without being overwritten by a replayed create', async () => {
  const { files, installationId, operationId } = await fixture();
  const choice = {
    id: 'choice-action-1',
    ref: 'action-1',
    url: 'https://orders.example.com/search',
    control: { role: 'checkbox', group: '通知', label: '发送通知', state: true },
  };
  const value = { ...candidate, workflow: { ...candidate.workflow, choices: [choice] } };
  const receipt = await files.create(installationId, operationId, value);
  const first = await files.read(installationId, receipt.skillId);
  assert.deepEqual(first.candidate.workflow.choices, [choice]);
  const directory = await files.directoryPath(installationId, receipt.skillId);
  const edited = structuredClone(value.workflow);
  edited.choices[0].control.state = false;
  await writeFile(join(directory, 'workflow.json'), JSON.stringify(edited, null, 2));
  const after = await files.read(installationId, receipt.skillId);
  assert.equal(after.candidate.workflow.choices[0].control.state, false);
  assert.notEqual(after.definitionHash, first.definitionHash);
  assert.deepEqual(await files.create(installationId, operationId, value), receipt);
  assert.equal(
    (await files.read(installationId, receipt.skillId)).candidate.workflow.choices[0].control.state,
    false
  );
});

test('native path checks reject a junction library and never write outside the fixed project root', async () => {
  const { root, files, installationId, operationId } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'octopus-browser-skills-outside-'));
  await symlink(outside, join(root, 'skills'), 'junction');
  await assert.rejects(files.create(installationId, operationId, candidate), /SKILL_PATH/);
  await assert.rejects(
    readFile(join(outside, 'browser-recordings', installationId, operationId, 'SKILL.md')),
    { code: 'ENOENT' }
  );
});

test('an existing unowned target directory is not replaced and invalid cross-file inputs never publish', async () => {
  const { root, files, installationId, operationId } = await fixture();
  await files.create(installationId, randomUUID(), candidate);
  const target = join(root, 'skills', 'browser-recordings', installationId, operationId);
  await mkdir(target);
  await writeFile(join(target, 'user.txt'), 'keep');
  await assert.rejects(files.create(installationId, operationId, candidate), /SKILL_CONFLICT/);
  assert.equal(await readFile(join(target, 'user.txt'), 'utf8'), 'keep');
  await assert.rejects(
    files.create(installationId, randomUUID(), {
      ...candidate,
      skillMarkdown: candidate.skillMarkdown + '\n{{notDeclared}}',
    })
  );
});
