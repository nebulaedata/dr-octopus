/**
 * @author Codex
 * @description Verifies first-release occupancy checks work before the output directory exists.
 */
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { acquireKnowledgeReleaseInstallGuard, assertSchedulerReleaseIdle } from '../src/release-use.ts';
import { tryAcquireProcessLock } from '../../../packages/agent/dist/lib/daemon-platform/singleton-lease.js';
import { acquireKnowledgeReleaseUse } from '../../../packages/agent/dist/extensions/knowledge/lib/release-use.js';

test('first installation excludes new daemon starts before native dependencies exist', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-first-knowledge-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const release = join(root, 'runtime');
  await mkdir(release);
  await writeFile(join(release, 'release-layout.json'), '{}');
  const entry = join(release, 'entry.mjs');
  await writeFile(entry, '');
  await writeFile(release + '.install.lock', 'installer');
  const unlock = await acquireKnowledgeReleaseInstallGuard(release, join(release, 'cli'));
  await assert.rejects(acquireKnowledgeReleaseUse(pathToFileURL(entry).href), { code: 'RELEASE_IN_USE' });
  unlock();
  await rm(release + '.install.lock');
  const owner = await acquireKnowledgeReleaseUse(pathToFileURL(entry).href);
  owner.release();
});

test('A Scheduler in another installation does not require the new release directory to exist', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'octopus release use '));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const sdkRoot = join(temp, 'cli');
  const agent = join(sdkRoot, 'node_modules/@octopus/agent');
  await mkdir(join(agent, 'dist'), { recursive: true });
  await writeFile(
    join(agent, 'package.json'),
    JSON.stringify({
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    })
  );
  await writeFile(
    join(agent, 'dist/index.js'),
    'export async function getSchedulerServiceStatus() { return { state: "control-ready", pid: process.ppid }; }'
  );
  const target = join(temp, 'new-release');
  await assertSchedulerReleaseIdle(target, sdkRoot);
  await assert.rejects(access(target), { code: 'ENOENT' });
});

test('Scheduler occupancy skips only a missing SDK or its unbuilt entry', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'octopus-sdk-absence-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const target = join(temp, 'new-release');
  await assertSchedulerReleaseIdle(target, temp);
  const agent = join(temp, 'node_modules/@octopus/agent');
  await mkdir(agent, { recursive: true });
  await writeFile(
    join(agent, 'package.json'),
    JSON.stringify({
      type: 'module',
      exports: { '.': { import: './entry.js' } },
    })
  );
  await assertSchedulerReleaseIdle(target, temp);
  await writeFile(join(agent, 'entry.js'), "import 'missing-runtime-dependency';");
  await assert.rejects(assertSchedulerReleaseIdle(target, temp), /missing-runtime-dependency/);
  await writeFile(
    join(agent, 'entry.js'),
    "export async function getSchedulerServiceStatus() { return { state: 'unavailable' }; }"
  );
  const previousDirectory = process.env.DR_OCTOPUS_CODING_AGENT_DIR;
  process.env.DR_OCTOPUS_CODING_AGENT_DIR = join(temp, 'missing-agent');
  try {
    await assert.rejects(assertSchedulerReleaseIdle(target, temp), { code: 'RELEASE_USE_UNVERIFIED' });
  } finally {
    if (previousDirectory === undefined) delete process.env.DR_OCTOPUS_CODING_AGENT_DIR;
    else process.env.DR_OCTOPUS_CODING_AGENT_DIR = previousDirectory;
  }
});

test('every knowledge profile shares the release lease and installation excludes all live owners', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-knowledge-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const release = join(root, 'release');
  await mkdir(release);
  const carrier = release + '.knowledge-use.lock';
  const first = await tryAcquireProcessLock(carrier, 'shared');
  const second = await tryAcquireProcessLock(carrier, 'shared');
  assert.ok(first && second);
  try {
    await assert.rejects(acquireKnowledgeReleaseInstallGuard(release), { code: 'RELEASE_IN_USE' });
    first.release();
    await assert.rejects(acquireKnowledgeReleaseInstallGuard(release), { code: 'RELEASE_IN_USE' });
  } finally {
    first.release();
    second.release();
  }
  const unlock = await acquireKnowledgeReleaseInstallGuard(release);
  try {
    assert.equal(await tryAcquireProcessLock(carrier, 'shared'), null);
  } finally {
    unlock();
  }
  const resumed = await tryAcquireProcessLock(carrier, 'shared');
  assert.ok(resumed);
  resumed.release();
});

test('unreachable Scheduler allows a stale endpoint only when its lifecycle lock has no owner', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'octopus-stale-scheduler-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const agentDirectory = join(temp, 'profile', 'agent');
  const scheduler = join(temp, 'profile', 'scheduler');
  const sdk = join(temp, 'node_modules', '@octopus', 'agent');
  await mkdir(agentDirectory, { recursive: true });
  await mkdir(scheduler);
  await mkdir(sdk, { recursive: true });
  await writeFile(join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  await writeFile(
    join(sdk, 'index.js'),
    "export async function getSchedulerServiceStatus() { return { state: 'unavailable' }; }"
  );
  const carrier = join(scheduler, 'daemon.lock');
  const previousDirectory = process.env.DR_OCTOPUS_CODING_AGENT_DIR;
  process.env.DR_OCTOPUS_CODING_AGENT_DIR = agentDirectory;
  t.after(() => {
    if (previousDirectory === undefined) delete process.env.DR_OCTOPUS_CODING_AGENT_DIR;
    else process.env.DR_OCTOPUS_CODING_AGENT_DIR = previousDirectory;
  });
  const target = join(temp, 'release');
  await assert.rejects(assertSchedulerReleaseIdle(target, temp), { code: 'RELEASE_USE_UNVERIFIED' });
  const owner = await tryAcquireProcessLock(carrier);
  assert.ok(owner);
  try {
    await assert.rejects(assertSchedulerReleaseIdle(target, temp), { code: 'RELEASE_USE_UNVERIFIED' });
  } finally {
    owner.release();
  }
  await assertSchedulerReleaseIdle(target, temp);
  await access(carrier);
  const nextOwner = await tryAcquireProcessLock(carrier);
  assert.ok(nextOwner, 'the occupancy check must release its lock');
  nextOwner.release();
});
