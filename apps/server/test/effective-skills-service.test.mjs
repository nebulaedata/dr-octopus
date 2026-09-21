/**
 * @author Codex
 * @description Verifies effective Skill catalogs from live Pi Runtime snapshots and dormant loader previews.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { EffectiveSkillsService } from '../dist/modules/skills/effective-skills.service.js';

const serviceServer = Fastify();
test.after(() => serviceServer.close());

/**
 * Creates an isolated Workspace and agent directory for one test.
 */
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'octopus-effective-skills-'));
  const cwd = join(root, 'workspace');
  const agentDir = join(root, 'agent');
  await mkdir(cwd, { recursive: true });
  return {
    root,
    cwd,
    agentDir,
    workspaceService: {
      async resolve(selector) {
        assert.equal(selector.id, 'ws-1');
        return { id: 'ws-1', cwd };
      },
    },
  };
}

/**
 * Creates the complete immutable binding expected by Session-first Runtime acquisition.
 */
function createBinding(fixture, overrides = {}) {
  return {
    runtimeId: 'runtime-1',
    epoch: 1,
    workspaceId: 'ws-1',
    workspaceCwd: fixture.cwd,
    sessionId: 'session-1',
    agentSessionId: 'agent-session-1',
    sessionPath: join(fixture.root, 'session-1.jsonl'),
    state: 'idle',
    lastActiveAt: 0,
    ...overrides,
  };
}

test('live Runtime catalog is authoritative and preserves source ownership', async () => {
  const fixture = await createFixture();
  try {
    const skillPath = join(fixture.agentDir, 'skills', 'runtime-skill', 'SKILL.md');
    await mkdir(join(fixture.agentDir, 'skills', 'runtime-skill'), { recursive: true });
    await writeFile(skillPath, '---\ndescription: Runtime skill.\n---\n', 'utf8');
    const runtime = {
      getBinding(runtimeId) {
        assert.equal(runtimeId, 'runtime-1');
        return createBinding(fixture);
      },
      async withExisting(_input, operation) {
        return operation({
          binding: createBinding(fixture),
          async execute(command) {
            assert.deepEqual(command, { type: 'get_commands' });
            return {
              success: true,
              data: {
                commands: [
                  {
                    name: 'skill:runtime-skill',
                    description: 'Runtime skill.',
                    source: 'skill',
                    sourceInfo: {
                      path: skillPath,
                      source: 'local',
                      scope: 'user',
                      origin: 'top-level',
                    },
                  },
                  {
                    name: 'workspace',
                    description: 'Not a Skill.',
                    source: 'extension',
                    sourceInfo: {
                      path: '<octopus-workspace>',
                      source: 'extension',
                      scope: 'temporary',
                      origin: 'top-level',
                    },
                  },
                ],
              },
            };
          },
        });
      },
    };
    const service = new EffectiveSkillsService(serviceServer, {
      workspaceService: fixture.workspaceService,
      runtime,
      agentDir: fixture.agentDir,
    });

    const catalog = await service.list('ws-1', 'runtime-1');

    assert.equal(catalog.consistency, 'runtime');
    assert.equal(catalog.skills.length, 1);
    assert.deepEqual(catalog.skills[0], {
      name: 'runtime-skill',
      description: 'Runtime skill.',
      source: 'local',
      scope: 'user',
      origin: 'top-level',
      editable: true,
      managedScope: 'global',
    });
    assert.match(catalog.generation, /^[a-f0-9]{64}$/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('dormant catalog uses Pi resource discovery and includes the managed Workspace root', async () => {
  const fixture = await createFixture();
  try {
    const skillDir = join(fixture.cwd, '.dr-octopus', 'skills', 'workspace-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: workspace-skill\ndescription: Workspace skill.\n---\n\nInstructions.\n',
      'utf8'
    );
    const service = new EffectiveSkillsService(serviceServer, {
      workspaceService: fixture.workspaceService,
      runtime: {
        getBinding() {
          throw new Error('Runtime must not be consulted for a dormant preview.');
        },
        async withExisting() {
          throw new Error('Runtime must not be consulted for a dormant preview.');
        },
      },
      agentDir: fixture.agentDir,
    });

    const catalog = await service.list('ws-1');
    const skill = catalog.skills.find((candidate) => candidate.name === 'workspace-skill');

    assert.equal(catalog.consistency, 'resolved');
    assert.deepEqual(skill, {
      name: 'workspace-skill',
      description: 'Workspace skill.',
      source: 'auto',
      scope: 'project',
      origin: 'top-level',
      editable: true,
      managedScope: 'workspace',
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('cross-Workspace Runtime identities are rejected before RPC execution', async () => {
  const fixture = await createFixture();
  try {
    let executed = false;
    const service = new EffectiveSkillsService(serviceServer, {
      workspaceService: fixture.workspaceService,
      runtime: {
        getBinding() {
          return createBinding(fixture, { workspaceId: 'ws-2', runtimeId: 'runtime-2' });
        },
        async withExisting() {
          executed = true;
        },
      },
      agentDir: fixture.agentDir,
    });

    await assert.rejects(
      service.list('ws-1', 'runtime-2'),
      (error) => error.code === 'EFFECTIVE_SKILLS_RUNTIME_MISMATCH' && error.statusCode === 409
    );
    assert.equal(executed, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
