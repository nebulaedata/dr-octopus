/**
 * @author Codex
 * @description Verifies offline npm lifecycle execution, private command selection and rejection of altered Node resources.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ShellExecutor } from '../../src/runtime/basic/shell-executor.ts';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { NodeResources } from '../../src/runtime/basic/node-resources.ts';
import { testNodeResources } from '../fixtures/node-resources.mjs';
import { nodeCommand } from '../fixtures/shell-command.mjs';

const resources = fileURLToPath(new URL('../../dist/', import.meta.url));
const native = new NativeFileCommit(join(resources, 'native/file-commit.node'));
/**
 * Reads a separate archive-derived build anchor for source-only verification tests.
 */
function anchor() {
  return readFile(new URL('../../build/node-resources.hash', import.meta.url), 'utf8');
}

test('cancelled Node startup drains admitted checks and never admits file hashing', async () => {
  const isolated = new NativeFileCommit(join(resources, 'native/file-commit.node'));
  const signal = new AbortController();
  const expected = await anchor();
  let active = 0;
  let admitted = 0;
  let hashes = 0;
  let release;
  let entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const list = isolated.list.bind(isolated);
  isolated.list = async (path) => {
    active += 1;
    admitted += 1;
    if (admitted === 4) {
      entered();
    }
    try {
      await gate;
      return await list(path);
    } finally {
      active -= 1;
    }
  };
  isolated.readDigest = async () => {
    hashes += 1;
    throw new Error('Unexpected file admission');
  };
  const rejected = assert.rejects(
    NodeResources.open(resources, isolated, expected, signal.signal),
    /NODE_RESOURCE_CANCELLED/
  );
  await started;
  assert.equal(active, 4);
  signal.abort();
  release();
  await rejected;
  assert.equal(active, 0);
  assert.equal(admitted, 4);
  assert.equal(hashes, 0);
  const deadline = new AbortController();
  deadline.abort(new DOMException('fixture deadline', 'TimeoutError'));
  await assert.rejects(
    NodeResources.open(resources, isolated, expected, deadline.signal),
    /NODE_RESOURCE_TIMEOUT/
  );
  assert.equal(admitted, 4);
});

test('private Node/npm installs a local offline package and runs lifecycle/CLI without ambient runtimes or credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-node-'));
  const workspace = join(root, '中文 npm workspace');
  await mkdir(join(workspace, 'package'), { recursive: true });
  await writeFile(
    join(workspace, 'package/package.json'),
    JSON.stringify({
      name: 'offline-fixture',
      version: '1.0.0',
      bin: { 'offline-fixture': 'cli.js' },
      scripts: { install: 'node install.cjs' },
    })
  );
  await writeFile(
    join(workspace, 'package/install.cjs'),
    `require('node:fs').writeFileSync('installed.json', JSON.stringify({execPath:process.execPath,version:process.version}));`
  );
  await writeFile(
    join(workspace, 'package/cli.js'),
    '#!/usr/bin/env node\nconsole.log("offline 中文 CLI");\n'
  );
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0', private: true })
  );
  const maliciousHome = join(root, 'ambient-home');
  await mkdir(maliciousHome);
  await writeFile(join(maliciousHome, '.npmrc'), 'registry=http://127.0.0.1:1\nuser-agent=ambient-secret\n');
  const keys = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'NODE_OPTIONS',
    'NODE_PATH',
    'NPM_CONFIG_USERCONFIG',
    'npm_config_cache',
    'NPM_TOKEN',
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let shell;
  try {
    process.env.PATH = maliciousHome;
    process.env.HOME = maliciousHome;
    process.env.USERPROFILE = maliciousHome;
    process.env.NODE_OPTIONS = '--require ambient-missing-module';
    process.env.NODE_PATH = maliciousHome;
    process.env.NPM_CONFIG_USERCONFIG = join(maliciousHome, '.npmrc');
    process.env.npm_config_cache = maliciousHome;
    process.env.NPM_TOKEN = 'ambient-test-token';
    shell = await ShellExecutor.open(
      join(resources, 'native/process-supervisor.exe'),
      root,
      native,
      await testNodeResources(resources, native)
    );
    const script = `require('node:fs').writeFileSync('runtime.json',JSON.stringify({execPath:process.execPath,version:process.version,loader:process.env.NODE_OPTIONS,modules:process.env.NODE_PATH,token:process.env.NPM_TOKEN,home:process.env.HOME,cache:process.env.npm_config_cache,userconfig:process.env.npm_config_userconfig}));`;
    const result = await shell.run({
      ownerId: 'owner',
      taskId: 'node',
      cwd: workspace,
      command: `${nodeCommand(script)}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd --version; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npx.cmd --version; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd pack ./package --offline --pack-destination .; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd install --offline --no-package-lock ./offline-fixture-1.0.0.tgz; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd exec --offline -- offline-fixture; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd config get user-agent; exit $LASTEXITCODE`,
      idempotencyKey: 'offline',
      fingerprint: 'a'.repeat(64),
      timeoutMs: 30000,
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(result.terminationReason, 'completed');
    assert.match(result.output, /11\.19\.0/);
    assert.match(result.output, /offline 中文 CLI/);
    assert.doesNotMatch(result.output, /ambient-secret|ambient-test-token/);
    const executed = JSON.parse(await readFile(join(workspace, 'runtime.json'), 'utf8'));
    assert.equal(
      resolve(executed.execPath).toLowerCase(),
      join(resources, 'resources/node/node.exe').toLowerCase()
    );
    assert.equal(executed.version, 'v24.20.0');
    assert.equal(executed.loader, undefined);
    assert.equal(executed.modules, undefined);
    assert.equal(executed.token, undefined);
    assert.ok(resolve(executed.home).startsWith(root));
    assert.ok(resolve(executed.cache).startsWith(root));
    assert.ok(resolve(executed.userconfig).startsWith(root));
    const lifecycle = JSON.parse(
      await readFile(join(workspace, 'node_modules/offline-fixture/installed.json'), 'utf8')
    );
    assert.equal(lifecycle.execPath.toLowerCase(), executed.execPath.toLowerCase());
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    await shell?.close();
    assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'octopus-node-')));
    await rm(root, { recursive: true, force: true });
  }
});

test('Node resources reject wrong anchors, missing/tampered npm dependencies and reparse directories; relocated wrappers execute', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-node-integrity-'));
  const relocated = join(root, '中文 private toolchain');
  try {
    await mkdir(relocated);
    await cp(join(resources, 'resources/node'), join(relocated, 'resources/node'), { recursive: true });
    await cp(join(resources, 'node-resources.json'), join(relocated, 'node-resources.json'));
    await assert.rejects(NodeResources.open(relocated, native, '0'.repeat(64)), /NODE_INVENTORY_MISMATCH/);
    const owner = await NodeResources.open(relocated, native, await anchor());
    await owner.verifyEntries();
    const shell = await ShellExecutor.open(
      join(resources, 'native/process-supervisor.exe'),
      root,
      native,
      owner
    );
    try {
      const result = await shell.run({
        ownerId: 'owner',
        taskId: 'relocated',
        cwd: root,
        command:
          'node --version; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm.cmd --version; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npx.cmd --version; exit $LASTEXITCODE',
        idempotencyKey: 'versions',
        fingerprint: 'b'.repeat(64),
        timeoutMs: 15000,
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.output, /v24\.20\.0/);
      assert.match(result.output, /11\.19\.0/);
    } finally {
      await shell.close();
    }
    const extra = join(relocated, 'resources/node/unexpected.js');
    await writeFile(extra, 'unexpected');
    await assert.rejects(NodeResources.open(relocated, native, await anchor()), /NODE_UNEXPECTED_RESOURCE/);
    await rm(extra);
    const entry = join(relocated, 'resources/node/npm');
    const entryBytes = await readFile(entry);
    await writeFile(entry, 'changed');
    await assert.rejects(owner.verifyEntries(), /NODE_RESOURCE_MISMATCH/);
    await writeFile(entry, entryBytes);
    const dependency = join(relocated, 'resources/node/node_modules/npm/package.json');
    const original = await readFile(dependency);
    await writeFile(dependency, '{}');
    await assert.rejects(NodeResources.open(relocated, native, await anchor()), /NODE_RESOURCE_MISMATCH/);
    await writeFile(dependency, original);
    await rm(dependency);
    await assert.rejects(NodeResources.open(relocated, native, await anchor()), /NODE_RESOURCE_MISMATCH/);
    await writeFile(dependency, original);
    const npm = join(relocated, 'resources/node/node_modules/npm');
    assert.ok(resolve(npm).startsWith(resolve(root) + '\\'));
    await rm(npm, { recursive: true });
    await symlink(join(resources, 'resources/node/node_modules/npm'), npm, 'junction');
    await assert.rejects(
      NodeResources.open(relocated, native, await anchor()),
      /NODE_(UNEXPECTED_RESOURCE|DIRECTORY_INVALID)/
    );
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'octopus-node-integrity-')));
    await rm(root, { recursive: true, force: true });
  }
});
