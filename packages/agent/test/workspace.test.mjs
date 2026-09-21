/**
 * @author Codex
 * @description 验证 Workspace Service 持久化、安全约束、恢复语义与只读 Extension surface
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import workspaceExtension, {
  createWorkspacePaths,
  createWorkspaceService,
  createWorkspaceSessionBootstrap,
} from '../dist/extensions/workspace/index.js';
import { parseOctopusArgs } from '../dist/cli/parse-args.js';
import { registerWorkspaceCommand } from '../dist/extensions/workspace/extension/commands.js';
import { registerWorkspaceEvents } from '../dist/extensions/workspace/extension/events.js';

/**
 * @description 创建隔离的 Workspace Root，并在测试结束后清理。
 */
async function createFixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-workspace-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return { root, paths: createWorkspacePaths(root), service: createWorkspaceService(root) };
}

test('general exists without a registry record', async (context) => {
  const fixture = await createFixture(context);
  const workspaces = await fixture.service.list();

  assert.deepEqual(
    workspaces.map(({ id }) => id),
    ['general']
  );
  await assert.rejects(readFile(fixture.paths.registry, 'utf8'), { code: 'ENOENT' });
  assert.equal((await fixture.service.resolve({ slug: 'general' })).cwd, fixture.paths.general);
});

test('creates and resolves a project by id and slug', async (context) => {
  const fixture = await createFixture(context);
  const workspace = await fixture.service.create({ name: 'Demo Project' });

  assert.equal(workspace.slug, 'demo-project');
  assert.deepEqual(await fixture.service.resolve({ id: workspace.id }), workspace);
  assert.deepEqual(await fixture.service.resolve({ slug: 'demo-project' }), workspace);
  await assert.rejects(fixture.service.create({ name: 'Another Demo', slug: 'demo-project' }), {
    code: 'WORKSPACE_ALREADY_EXISTS',
  });
});

test('rejects invalid selectors and registry path escapes with stable codes', async (context) => {
  const fixture = await createFixture(context);
  await assert.rejects(fixture.service.resolve({}), { code: 'WORKSPACE_SELECTOR_INVALID' });
  await assert.rejects(fixture.service.resolve({ id: 'general', slug: 'general' }), {
    code: 'WORKSPACE_SELECTOR_INVALID',
  });

  await mkdir(fixture.paths.workspaces, { recursive: true });
  await writeFile(
    fixture.paths.registry,
    JSON.stringify({
      schemaVersion: 1,
      workspaces: [
        {
          schemaVersion: 1,
          id: 'escaped',
          kind: 'project',
          name: 'Escaped',
          slug: 'escaped',
          cwd: fixture.root,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })
  );
  await assert.rejects(fixture.service.list(), { code: 'WORKSPACE_PATH_VIOLATION' });
});

test('corrupt registry is never replaced by create', async (context) => {
  const fixture = await createFixture(context);
  await mkdir(fixture.paths.workspaces, { recursive: true });
  await writeFile(fixture.paths.registry, '{broken');

  await assert.rejects(fixture.service.create({ name: 'Demo' }), { code: 'WORKSPACE_REGISTRY_CORRUPT' });
  assert.equal(await readFile(fixture.paths.registry, 'utf8'), '{broken');
});

test('commits a published marker left by a failed registry write', async (context) => {
  const fixture = await createFixture(context);
  const id = '11111111-1111-4111-8111-111111111111';
  const cwd = join(fixture.paths.workspaces, id);
  const timestamp = new Date().toISOString();
  const descriptor = {
    schemaVersion: 1,
    id,
    kind: 'project',
    name: 'Recovered',
    slug: 'recovered',
    cwd,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, '.octopus-workspace.json'), JSON.stringify(descriptor));

  assert.deepEqual(await fixture.service.create({ name: 'Recovered' }), descriptor);
  assert.deepEqual(await fixture.service.resolve({ slug: 'recovered' }), descriptor);
});

test('extension registers the read-only Workspace tool and Workspace command', () => {
  const tools = [];
  const commands = [];
  const events = [];
  let workspaceCommand;
  workspaceExtension({
    registerTool(definition) {
      tools.push(definition.name);
    },
    registerCommand(name, options) {
      commands.push(name);
      workspaceCommand = options;
    },
    on(name) {
      events.push(name);
    },
  });

  assert.deepEqual(tools, ['workspace_current']);
  assert.deepEqual(commands, ['workspace']);
  assert.deepEqual(events, ['resources_discover']);
  assert.equal(workspaceCommand.description, 'Usage: /workspace current | list | create | open');
  const createCompletion = workspaceCommand
    .getArgumentCompletions('')
    .find(({ value }) => value === 'create ');
  assert.match(createCompletion.label, /\[--open\]/u);
  assert.match(createCompletion.description, /--open/u);
});

test('resources_discover exposes the Workspace skills directory only when it exists', async (context) => {
  const fixture = await createFixture(context);
  const cwd = join(fixture.root, 'project');
  let handler;
  registerWorkspaceEvents({
    on(name, registered) {
      assert.equal(name, 'resources_discover');
      handler = registered;
    },
  });

  assert.deepEqual(await handler({ cwd, reason: 'startup' }), {});
  await mkdir(join(cwd, '.dr-octopus', 'skills'), { recursive: true });
  assert.deepEqual(await handler({ cwd, reason: 'startup' }), {
    skillPaths: [join(cwd, '.dr-octopus', 'skills')],
  });
});

test('resources_discover ignores files and unreadable paths without throwing', async (context) => {
  const fixture = await createFixture(context);
  const cwd = join(fixture.root, 'project');
  await mkdir(join(cwd, '.dr-octopus'), { recursive: true });
  await writeFile(join(cwd, '.dr-octopus', 'skills'), 'not a directory');
  let handler;
  registerWorkspaceEvents({
    on(_name, registered) {
      handler = registered;
    },
  });

  assert.deepEqual(await handler({ cwd, reason: 'reload' }), {});
  assert.deepEqual(await handler({ cwd: join(fixture.root, 'missing'), reason: 'reload' }), {});
});

test('Pi Workspace Session bootstrap creates a header-only Session and safely cleans it up', async (context) => {
  const fixture = await createFixture(context);
  const project = await fixture.service.create({ name: 'Bootstrap Target' });
  const bootstrap = createWorkspaceSessionBootstrap();
  const pending = await bootstrap.create(project.cwd, {
    cwd: fixture.paths.general,
    sessionDir: join(fixture.root, 'shared-sessions'),
  });

  const lines = (await readFile(pending.sessionPath, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  const header = JSON.parse(lines[0]);
  assert.equal(header.type, 'session');
  assert.equal(header.cwd, project.cwd);

  await pending.cleanup();
  await assert.rejects(stat(pending.sessionPath), { code: 'ENOENT' });
});

test('workspace command creates a project and prints the restart command', async (context) => {
  const fixture = await createFixture(context);
  let command;
  const notifications = [];
  registerWorkspaceCommand(
    {
      registerCommand(_name, options) {
        command = options;
      },
    },
    fixture.service,
    { create: assert.fail }
  );

  await command.handler('create Demo Project --slug demo', {
    cwd: fixture.paths.general,
    hasUI: true,
    ui: {
      notify(message) {
        notifications.push(message);
      },
    },
  });

  assert.equal((await fixture.service.resolve({ slug: 'demo' })).name, 'Demo Project');
  assert.match(notifications[0], /Run: octopus --workspace demo/);
});

test('workspace open switches through a bootstrapped Session and cleans up cancellation', async (context) => {
  const fixture = await createFixture(context);
  const project = await fixture.service.create({ name: 'Open Target', slug: 'open-target' });
  let command;
  let cleaned = false;
  const sessionPath = join(fixture.root, 'pending.jsonl');
  registerWorkspaceCommand(
    {
      registerCommand(_name, options) {
        command = options;
      },
    },
    fixture.service,
    {
      async create(cwd, current) {
        assert.equal(cwd, project.cwd);
        assert.equal(current.cwd, fixture.paths.general);
        assert.equal(current.sessionDir, join(fixture.root, 'current-sessions'));
        return {
          sessionPath,
          async cleanup() {
            cleaned = true;
          },
        };
      },
    }
  );

  let switchedPath;
  await command.handler('open open-target', {
    cwd: fixture.paths.general,
    hasUI: true,
    ui: { notify() {} },
    sessionManager: { getSessionDir: () => join(fixture.root, 'current-sessions') },
    async switchSession(path) {
      switchedPath = path;
      return { cancelled: true };
    },
  });

  assert.equal(switchedPath, sessionPath);
  assert.equal(cleaned, true);
});

test('workspace open in the current Workspace delegates to Pi newSession', async (context) => {
  const fixture = await createFixture(context);
  let command;
  let newSessionCalls = 0;
  registerWorkspaceCommand(
    {
      registerCommand(_name, options) {
        command = options;
      },
    },
    fixture.service,
    { create: assert.fail }
  );

  await command.handler('open general', {
    cwd: fixture.paths.general,
    hasUI: false,
    sessionManager: { getSessionDir: () => join(fixture.root, 'sessions') },
    async newSession() {
      newSessionCalls += 1;
      return { cancelled: false };
    },
  });

  assert.equal(newSessionCalls, 1);
});

test('workspace create --open creates the Workspace before switching', async (context) => {
  const fixture = await createFixture(context);
  let command;
  let targetCwd;
  registerWorkspaceCommand(
    {
      registerCommand(_name, options) {
        command = options;
      },
    },
    fixture.service,
    {
      async create(cwd) {
        targetCwd = cwd;
        return { sessionPath: join(fixture.root, 'created-open.jsonl'), async cleanup() {} };
      },
    }
  );

  let switched = false;
  await command.handler('create Opened Project --slug opened --open', {
    cwd: fixture.paths.general,
    hasUI: false,
    sessionManager: { getSessionDir: () => join(fixture.root, 'sessions') },
    async switchSession() {
      switched = true;
      return { cancelled: false };
    },
  });

  const workspace = await fixture.service.resolve({ slug: 'opened' });
  assert.equal(targetCwd, workspace.cwd);
  assert.equal(switched, true);
});

test('parses and removes the Octopus workspace argument before invoking Pi', () => {
  assert.deepEqual(parseOctopusArgs(['--workspace', 'demo', '--model', 'test']), {
    workspaceSelector: { slug: 'demo' },
    piArgs: ['--model', 'test'],
  });
  assert.deepEqual(parseOctopusArgs(['--workspace=11111111-1111-4111-8111-111111111111']), {
    workspaceSelector: { id: '11111111-1111-4111-8111-111111111111' },
    piArgs: [],
  });
  assert.deepEqual(parseOctopusArgs([]), {
    workspaceSelector: { id: 'general' },
    piArgs: [],
  });
  assert.throws(() => parseOctopusArgs(['--workspace']), /id-or-slug/);
  assert.throws(() => parseOctopusArgs(['--workspace', 'one', '--workspace=two']), /only be specified once/);
});
