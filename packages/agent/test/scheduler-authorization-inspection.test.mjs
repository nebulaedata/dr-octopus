/**
 * @author Codex
 * @description Checks real child-process SDK discovery, bounded failures and read-only configuration revisions.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectTaskTools } from '../dist/extensions/scheduler/infrastructure/authorization-probe.js';
import { inspectionConfigurationRevision } from '../dist/extensions/scheduler/infrastructure/inspection-configuration.js';

test(
  'explicit inspection initializes lazy tools in its child, excludes prohibited tools and cleans up',
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'explicit-inspection-'));
    const agentDir = join(root, 'agent');
    await mkdir(agentDir);
    const marker = join(root, 'marker');
    const previous = [process.env.TEST_INSPECTION_MARKER, process.env.TEST_INSPECTION_MODE];
    process.env.TEST_INSPECTION_MARKER = marker;
    delete process.env.TEST_INSPECTION_MODE;
    t.after(async () => {
      for (const [index, key] of ['TEST_INSPECTION_MARKER', 'TEST_INSPECTION_MODE'].entries()) {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      }
      await rm(root, { recursive: true, force: true });
    });
    const task = {
      id: 'task',
      workspaceId: 'workspace',
      cwd: root,
      prompt: 'Inspect',
      configRevision: 'v1',
      timeoutMs: 1000,
    };
    const cliPath = fileURLToPath(new URL('./fixtures/authorization-inspection.mjs', import.meta.url));
    const tools = await inspectTaskTools(agentDir, root, 'profile', task, { cliPath, timeoutMs: 10000 });
    assert.ok(tools.some((tool) => tool.name === 'ctx_fixture'));
    assert.ok(!tools.some((tool) => tool.name === 'ctx_upgrade'));
    assert.equal(await readFile(marker, 'utf8'), 'initialized\n');
    assert.deepEqual(await readdir(join(root, 'inspections')).catch(() => []), []);
    process.env.TEST_INSPECTION_MODE = 'fail';
    await assert.rejects(
      inspectTaskTools(agentDir, root, 'profile', task, { cliPath, timeoutMs: 10000 }),
      /tool initialization/
    );
    process.env.TEST_INSPECTION_MODE = 'hang';
    await assert.rejects(
      inspectTaskTools(agentDir, root, 'profile', task, { cliPath, timeoutMs: 3000 }),
      /timed out/
    );
  }
);

test('configuration checks detect policy and extension entry edits without running the extension', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'inspection-config-'));
  const agentDir = join(root, 'agent');
  await mkdir(join(agentDir, 'extensions'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const extension = join(agentDir, 'extensions', 'fixture.js');
  await writeFile(extension, 'throw new Error("Must not load during configuration reads")');
  const first = await inspectionConfigurationRevision(agentDir, root);
  assert.equal(await inspectionConfigurationRevision(agentDir, root), first);
  await writeFile(extension, 'throw new Error("Changed entry, still must not load")');
  const second = await inspectionConfigurationRevision(agentDir, root);
  assert.notEqual(second, first);
  await writeFile(join(agentDir, 'permission-system.json'), '{"policy":{"tools":{"ctx_fixture":"deny"}}}');
  assert.notEqual(await inspectionConfigurationRevision(agentDir, root), second);
});

test(
  'inspection reads upstream tool configuration from the selected Agent directory',
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'inspection-agent-directory-'));
    const agentDir = join(root, 'selected-agent');
    const inheritedDir = join(root, 'other-agent');
    await mkdir(agentDir);
    await mkdir(inheritedDir);
    await writeFile(join(agentDir, 'tool-description.txt'), 'Selected workspace tools');
    await writeFile(join(inheritedDir, 'tool-description.txt'), 'Wrong profile tools');
    const keys = ['PI_CODING_AGENT_DIR', 'TEST_INSPECTION_MARKER', 'TEST_INSPECTION_MODE'];
    const previous = keys.map((key) => process.env[key]);
    t.after(async () => {
      for (const [index, key] of keys.entries()) {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      }
      await rm(root, { recursive: true, force: true });
    });
    process.env.TEST_INSPECTION_MARKER = join(root, 'marker');
    process.env.TEST_INSPECTION_MODE = 'directory';
    const task = {
      id: 'task',
      workspaceId: 'workspace',
      cwd: root,
      prompt: 'Inspect',
      configRevision: 'v1',
      timeoutMs: 1000,
    };
    const cliPath = fileURLToPath(new URL('./fixtures/authorization-inspection.mjs', import.meta.url));
    let identity;
    for (const inherited of [undefined, inheritedDir]) {
      if (inherited === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = inherited;
      const tools = await inspectTaskTools(agentDir, root, 'profile', task, { cliPath, timeoutMs: 10000 });
      const tool = tools.find((entry) => entry.name === 'ctx_fixture');
      assert.equal(tool?.description, 'Selected workspace tools');
      if (identity !== undefined) assert.equal(tool.identity, identity);
      identity = tool.identity;
      assert.equal(process.env.PI_CODING_AGENT_DIR, inherited);
    }
  }
);
