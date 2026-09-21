/**
 * @author Claude Code
 * @description Verifies Global and Workspace scope Skill lifecycle behavior of the Skills Service.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync } from 'fflate';
import Fastify from 'fastify';
import { SkillsService } from '../dist/modules/skills/skills.service.js';

const GLOBAL = { kind: 'global' };
const WORKSPACE = { kind: 'workspace', workspaceId: 'ws-1' };
const serviceServer = Fastify();
test.after(() => serviceServer.close());

/**
 * Creates an isolated Global Skills root and the service under test for one test case.
 */
async function createFixture() {
  const skillsRoot = await mkdtemp(join(tmpdir(), 'octopus-skills-'));
  const service = new SkillsService(serviceServer, { skillsRoot });
  return {
    service,
    skillsRoot,
    async cleanup() {
      await rm(skillsRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Creates a service wired to one stub Workspace whose cwd lives in a temporary directory.
 */
async function createWorkspaceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'octopus-workspace-skills-'));
  const skillsRoot = join(root, 'global-skills');
  const workspaceCwd = join(root, 'workspace-cwd');
  await mkdir(workspaceCwd, { recursive: true });
  const workspaceSkillsRoot = join(workspaceCwd, '.dr-octopus', 'skills');
  const service = new SkillsService(serviceServer, {
    skillsRoot,
    workspaceService: {
      async resolve(selector) {
        if (selector.id !== 'ws-1') {
          const error = new Error('Workspace was not found.');
          error.code = 'WORKSPACE_NOT_FOUND';
          throw error;
        }
        return { cwd: workspaceCwd };
      },
    },
  });
  return {
    service,
    skillsRoot,
    workspaceCwd,
    workspaceSkillsRoot,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * Encodes a deterministic zip archive as a Base64 upload payload.
 */
function zipPayload(entries) {
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, content]) => [name, new TextEncoder().encode(content)])
    )
  );
  return Buffer.from(zipped).toString('base64');
}

test('create persists a directory Skill that list and get can read back', async () => {
  const { service, skillsRoot, cleanup } = await createFixture();
  try {
    const created = await service.create(GLOBAL, {
      name: 'code-review',
      description: 'Reviews code changes.',
      body: '# Code Review\n\nCheck the diff.',
    });
    assert.equal(created.name, 'code-review');
    assert.equal(created.description, 'Reviews code changes.');
    assert.equal(created.body, '# Code Review\n\nCheck the diff.');
    assert.deepEqual(created.warnings, []);

    const listed = await service.list(GLOBAL);
    assert.equal(listed.root, skillsRoot);
    assert.equal(listed.skills.length, 1);
    assert.equal(listed.skills[0].name, 'code-review');
    assert.equal(listed.skills[0].fileCount, 1);

    const detail = await service.get(GLOBAL, 'code-review');
    assert.equal(detail.files.length, 1);
    assert.equal(detail.files[0].path, 'SKILL.md');
  } finally {
    await cleanup();
  }
});

test('create rejects invalid names and duplicates with stable error codes', async () => {
  const { service, cleanup } = await createFixture();
  try {
    await assert.rejects(
      service.create(GLOBAL, { name: 'Bad Name', description: 'x', body: 'y' }),
      (error) => error.code === 'SKILL_NAME_INVALID' && error.statusCode === 400
    );
    await service.create(GLOBAL, { name: 'taken', description: 'x', body: 'y' });
    await assert.rejects(
      service.create(GLOBAL, { name: 'taken', description: 'x', body: 'y' }),
      (error) => error.code === 'SKILL_ALREADY_EXISTS' && error.statusCode === 409
    );
  } finally {
    await cleanup();
  }
});

test('update merges editable fields and preserves unknown frontmatter keys', async () => {
  const { service, skillsRoot, cleanup } = await createFixture();
  try {
    await mkdir(join(skillsRoot, 'legacy'), { recursive: true });
    await writeFile(
      join(skillsRoot, 'legacy', 'SKILL.md'),
      '---\nname: legacy\ndescription: Old summary.\nlicense: MIT\ndisable-model-invocation: true\n---\n\nOld body.\n',
      'utf8'
    );

    const updated = await service.update(GLOBAL, 'legacy', {
      description: 'New summary.',
      disableModelInvocation: false,
      body: 'New body.',
    });
    assert.equal(updated.description, 'New summary.');
    assert.equal(updated.disableModelInvocation, false);
    assert.equal(updated.body, 'New body.');

    const raw = await readFile(join(skillsRoot, 'legacy', 'SKILL.md'), 'utf8');
    assert.match(raw, /license: MIT/);
    assert.doesNotMatch(raw, /disable-model-invocation/);
  } finally {
    await cleanup();
  }
});

test('upload stores a Markdown file as a directory Skill and honors overwrite consent', async () => {
  const { service, cleanup } = await createFixture();
  try {
    const markdown = '---\ndescription: From upload.\n---\n\nUploaded body.\n';
    const data = Buffer.from(markdown, 'utf8').toString('base64');
    const uploaded = await service.upload(GLOBAL, { filename: 'research-notes.md', data });
    assert.equal(uploaded.name, 'research-notes');
    assert.equal(uploaded.description, 'From upload.');

    await assert.rejects(service.upload(GLOBAL, { filename: 'research-notes.md', data }), (error) => {
      return error.code === 'SKILL_ALREADY_EXISTS' && error.statusCode === 409;
    });

    const replaced = await service.upload(GLOBAL, { filename: 'research-notes.md', data, overwrite: true });
    assert.equal(replaced.name, 'research-notes');
  } finally {
    await cleanup();
  }
});

test('upload extracts a zip bundle with a single top-level directory', async () => {
  const { service, cleanup } = await createFixture();
  try {
    const data = zipPayload({
      'deep-research/SKILL.md': '---\ndescription: Deep research.\n---\n\nPlan first.\n',
      'deep-research/scripts/run.sh': 'echo hi\n',
      '__MACOSX/deep-research/._SKILL.md': 'junk',
    });
    const uploaded = await service.upload(GLOBAL, { filename: 'bundle.zip', data });
    assert.equal(uploaded.name, 'deep-research');
    assert.deepEqual(
      uploaded.files.map((file) => file.path),
      ['SKILL.md', 'scripts/run.sh']
    );
  } finally {
    await cleanup();
  }
});

test('upload rejects archives without SKILL.md and unsafe entry paths', async () => {
  const { service, cleanup } = await createFixture();
  try {
    await assert.rejects(
      service.upload(GLOBAL, { filename: 'empty.zip', data: zipPayload({ 'README.md': 'no skill here' }) }),
      (error) => error.code === 'SKILL_ARCHIVE_INVALID' && error.statusCode === 400
    );
    await assert.rejects(
      service.upload(GLOBAL, {
        filename: 'evil.zip',
        data: zipPayload({ '../escape/SKILL.md': '---\ndescription: x\n---\n\ny\n' }),
      }),
      (error) => error.code === 'SKILL_ARCHIVE_INVALID' && error.statusCode === 400
    );
  } finally {
    await cleanup();
  }
});

test('upload rejects Markdown without a frontmatter description', async () => {
  const { service, cleanup } = await createFixture();
  try {
    const data = Buffer.from('# No frontmatter at all\n', 'utf8').toString('base64');
    await assert.rejects(service.upload(GLOBAL, { filename: 'plain.md', data }), (error) => {
      return error.code === 'SKILL_DESCRIPTION_INVALID' && error.statusCode === 400;
    });
  } finally {
    await cleanup();
  }
});

test('remove deletes a Skill directory and reports missing Skills as 404', async () => {
  const { service, skillsRoot, cleanup } = await createFixture();
  try {
    await service.create(GLOBAL, { name: 'doomed', description: 'x', body: 'y' });
    await service.remove(GLOBAL, 'doomed');
    await assert.rejects(access(join(skillsRoot, 'doomed')));
    await assert.rejects(service.remove(GLOBAL, 'doomed'), (error) => {
      return error.code === 'SKILL_NOT_FOUND' && error.statusCode === 404;
    });
  } finally {
    await cleanup();
  }
});

test('get and remove still reach a directory Skill the loader rejects', async () => {
  const { service, skillsRoot, cleanup } = await createFixture();
  try {
    await mkdir(join(skillsRoot, 'broken'), { recursive: true });
    await writeFile(
      join(skillsRoot, 'broken', 'SKILL.md'),
      '---\nname: broken\n---\n\nNo description.\n',
      'utf8'
    );

    const detail = await service.get(GLOBAL, 'broken');
    assert.equal(detail.description, '');
    assert.ok(detail.warnings.length > 0);

    await service.remove(GLOBAL, 'broken');
    await assert.rejects(service.get(GLOBAL, 'broken'), (error) => error.code === 'SKILL_NOT_FOUND');
  } finally {
    await cleanup();
  }
});

test('workspace scope manages Skills under the Workspace .dr-octopus directory', async () => {
  const { service, workspaceSkillsRoot, cleanup } = await createWorkspaceFixture();
  try {
    const created = await service.create(WORKSPACE, {
      name: 'project-setup',
      description: 'Sets up this project.',
      body: '# Project Setup\n\nRun the bootstrap.',
    });
    assert.equal(created.name, 'project-setup');

    const raw = await readFile(join(workspaceSkillsRoot, 'project-setup', 'SKILL.md'), 'utf8');
    assert.match(raw, /name: project-setup/);

    const listed = await service.list(WORKSPACE);
    assert.equal(listed.root, workspaceSkillsRoot);
    assert.deepEqual(
      listed.skills.map((skill) => skill.name),
      ['project-setup']
    );

    await service.update(WORKSPACE, 'project-setup', {
      description: 'Updated summary.',
      body: 'Updated body.',
    });
    assert.equal((await service.get(WORKSPACE, 'project-setup')).description, 'Updated summary.');

    await service.remove(WORKSPACE, 'project-setup');
    await assert.rejects(access(join(workspaceSkillsRoot, 'project-setup')));
    assert.deepEqual((await service.list(WORKSPACE)).skills, []);
  } finally {
    await cleanup();
  }
});

test('workspace and global scopes stay isolated from each other', async () => {
  const { service, skillsRoot, workspaceSkillsRoot, cleanup } = await createWorkspaceFixture();
  try {
    await service.create(GLOBAL, { name: 'shared-name', description: 'Global copy.', body: 'Global body.' });
    await service.create(WORKSPACE, {
      name: 'shared-name',
      description: 'Workspace copy.',
      body: 'Workspace body.',
    });

    assert.equal((await service.get(GLOBAL, 'shared-name')).description, 'Global copy.');
    assert.equal((await service.get(WORKSPACE, 'shared-name')).description, 'Workspace copy.');
    assert.equal((await service.list(GLOBAL)).skills.length, 1);
    assert.equal((await service.list(WORKSPACE)).skills.length, 1);

    await service.remove(WORKSPACE, 'shared-name');
    assert.deepEqual((await service.list(WORKSPACE)).skills, []);
    await access(join(skillsRoot, 'shared-name'));
    await assert.rejects(access(join(workspaceSkillsRoot, 'shared-name')));
  } finally {
    await cleanup();
  }
});

test('workspace scope propagates Workspace resolution failures and reports missing resolver', async () => {
  const { service, cleanup } = await createWorkspaceFixture();
  try {
    await assert.rejects(
      service.list({ kind: 'workspace', workspaceId: 'missing' }),
      (error) => error.code === 'WORKSPACE_NOT_FOUND'
    );
  } finally {
    await cleanup();
  }

  const unscoped = new SkillsService(serviceServer, {
    skillsRoot: join(tmpdir(), 'octopus-no-resolver'),
  });
  await assert.rejects(
    unscoped.list(WORKSPACE),
    (error) => error.code === 'SKILL_WORKSPACE_UNAVAILABLE' && error.statusCode === 500
  );
});
