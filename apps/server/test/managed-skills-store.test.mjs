/**
 * @author Codex
 * @description Verifies the managed Skills filesystem adapter contract.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ManagedSkillsStore,
  ManagedSkillsStoreError,
} from '../dist/infrastructure/pi-skills/managed-skills-store.js';

/**
 * Creates an isolated Skills root and removes it after the supplied test operation.
 *
 * @param operation Test operation receiving the temporary Skills root.
 */
async function withSkillsRoot(operation) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-managed-skills-store-'));
  try {
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('ManagedSkillsStore discovers Skills through Pi and inventories their files', async () => {
  await withSkillsRoot(async (root) => {
    const skillDir = join(root, 'code-review');
    await mkdir(join(skillDir, 'references'), { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: code-review\ndescription: Review code safely.\n---\n\nInstructions.\n',
      'utf8'
    );
    await writeFile(join(skillDir, 'references', 'checks.md'), 'Checks.\n', 'utf8');

    const store = new ManagedSkillsStore(root);
    const skill = store.scan().get('code-review');

    assert.ok(skill);
    assert.equal(skill.description, 'Review code safely.');
    assert.deepEqual(
      (await store.statSkill(skill)).files.map((file) => file.path),
      ['SKILL.md', 'references/checks.md']
    );
  });
});

test('ManagedSkillsStore exposes neutral not-found failures', async () => {
  await withSkillsRoot(async (root) => {
    const store = new ManagedSkillsStore(root);

    await assert.rejects(
      store.resolve('missing'),
      (error) => error instanceof ManagedSkillsStoreError && error.reason === 'not-found'
    );
  });
});

test('ManagedSkillsStore rejects identities that escape its configured root', async () => {
  await withSkillsRoot(async (root) => {
    const store = new ManagedSkillsStore(root);

    await assert.rejects(
      store.resolve('../outside'),
      (error) => error instanceof ManagedSkillsStoreError && error.reason === 'invalid-name'
    );
  });
});
