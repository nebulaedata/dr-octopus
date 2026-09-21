/**
 * @author Claude Code
 * @description Smoke-verifies dual-scope Skill HTTP APIs against an isolated live Server.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'octopus-skills-smoke-'));
const agentDir = join(root, 'agent');
const serverDataDir = join(root, 'server');
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}/api`;

const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  env: {
    ...process.env,
    // Isolate every homedir-anchored state root (Octopus workspaces, Pi agent dir, Server data).
    USERPROFILE: root,
    HOME: root,
    DR_OCTOPUS_CODING_AGENT_DIR: agentDir,
    SERVER_DATA_DIR: serverDataDir,
    SERVER_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

async function request(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => undefined);
  return { status: response.status, payload };
}

async function waitReady() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before becoming ready (${server.exitCode}):\n${serverLog}`);
    }
    try {
      const response = await fetch(`${base}/workspaces`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry until the listener is up
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become ready:\n${serverLog}`);
}

try {
  await waitReady();

  // Create one Workspace through the public API.
  const createdWorkspace = await request('POST', '/workspaces', {
    name: 'Skills Smoke',
    slug: 'skills-smoke',
  });
  assert.equal(createdWorkspace.status, 201);
  const workspaceId = createdWorkspace.payload.id;
  const workspaceCwd = createdWorkspace.payload.cwd;

  // Global scope: create, list, get, update, delete.
  const globalCreate = await request('POST', '/skills', {
    name: 'smoke-global',
    description: 'Global smoke skill.',
    body: '# Global\n\nGlobal body.',
  });
  assert.equal(globalCreate.status, 201, JSON.stringify(globalCreate.payload));
  const globalList = await request('GET', '/skills');
  assert.deepEqual(
    globalList.payload.skills.map((skill) => skill.name),
    ['smoke-global']
  );
  const globalRaw = await readFile(join(agentDir, 'skills', 'smoke-global', 'SKILL.md'), 'utf8');
  assert.match(globalRaw, /name: smoke-global/);

  // Workspace scope: same name must not collide with the Global copy.
  const workspaceCreate = await request('POST', `/workspaces/${workspaceId}/skills`, {
    name: 'smoke-global',
    description: 'Workspace smoke skill.',
    body: '# Workspace\n\nWorkspace body.',
  });
  assert.equal(workspaceCreate.status, 201, JSON.stringify(workspaceCreate.payload));
  const workspaceRaw = await readFile(
    join(workspaceCwd, '.dr-octopus', 'skills', 'smoke-global', 'SKILL.md'),
    'utf8'
  );
  assert.match(workspaceRaw, /description: Workspace smoke skill/);

  // Both scopes stay isolated.
  const workspaceList = await request('GET', `/workspaces/${workspaceId}/skills`);
  assert.deepEqual(
    workspaceList.payload.skills.map((skill) => skill.name),
    ['smoke-global']
  );
  const globalDetail = await request('GET', '/skills/smoke-global');
  assert.equal(globalDetail.payload.skill.description, 'Global smoke skill.');
  const workspaceDetail = await request('GET', `/workspaces/${workspaceId}/skills/smoke-global`);
  assert.equal(workspaceDetail.payload.skill.description, 'Workspace smoke skill.');

  // Workspace scope: update and upload round-trip.
  const workspaceUpdate = await request('PUT', `/workspaces/${workspaceId}/skills/smoke-global`, {
    description: 'Updated workspace skill.',
    body: '# Updated\n\nUpdated body.',
  });
  assert.equal(workspaceUpdate.status, 200);
  assert.equal(workspaceUpdate.payload.skill.description, 'Updated workspace skill.');

  const markdown = '---\ndescription: Uploaded workspace skill.\n---\n\nUploaded body.\n';
  const workspaceUpload = await request('POST', `/workspaces/${workspaceId}/skills/upload`, {
    filename: 'smoke-upload.md',
    data: Buffer.from(markdown, 'utf8').toString('base64'),
  });
  assert.equal(workspaceUpload.status, 201, JSON.stringify(workspaceUpload.payload));
  assert.equal(workspaceUpload.payload.skill.name, 'smoke-upload');
  await access(join(workspaceCwd, '.dr-octopus', 'skills', 'smoke-upload', 'SKILL.md'));

  // Unknown Workspace surfaces the Workspace not-found contract (same as the files routes).
  const unknown = await request('GET', '/workspaces/00000000-0000-4000-8000-000000000000/skills');
  assert.equal(unknown.status, 400, JSON.stringify(unknown.payload));
  assert.equal(unknown.payload.code, 'WORKSPACE_NOT_FOUND');

  // Delete both scopes and confirm on-disk removal.
  const workspaceDelete = await request('DELETE', `/workspaces/${workspaceId}/skills/smoke-global`);
  assert.equal(workspaceDelete.status, 200);
  const globalDelete = await request('DELETE', '/skills/smoke-global');
  assert.equal(globalDelete.status, 200);
  assert.deepEqual((await request('GET', `/workspaces/${workspaceId}/skills`)).payload.skills.length, 1);
  assert.deepEqual((await request('GET', '/skills')).payload.skills, []);

  console.log('dual-scope skills smoke OK');
} finally {
  if (server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  await rm(root, { recursive: true, force: true });
}
