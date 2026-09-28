/**
 * @author Codex
 * @description Exercises the release image through the public Compose contract using disposable isolated volumes.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const directory = mkdtempSync(join(tmpdir(), 'octopus-docker-smoke-'));
const project = `octopus-smoke-${randomUUID().slice(0, 8)}`;
const reference = process.env.IMAGE_REFERENCE;
assert.ok(reference, 'IMAGE_REFERENCE is required');
const override = join(directory, 'compose.override.json');
writeFileSync(
  override,
  JSON.stringify({ services: { 'dr-octopus': { image: reference, pull_policy: 'never', restart: 'no' } } })
);
const environment = {
  ...process.env,
  IMAGE_TAG: 'smoke',
  BIND_ADDRESS: '127.0.0.1',
  HTTP_PORT: '0',
  SERVER_CORS_ORIGIN: '',
  LOG_LEVEL: 'info',
};
const composeArgs = [
  'compose',
  '--project-name',
  project,
  '--env-file',
  resolve('deploy/docker/.env.example'),
  '-f',
  resolve('deploy/docker/compose.yaml'),
  '-f',
  override,
];
const roots = ['/home/node/.dr-octopus/server', '/home/node/.dr-octopus/agent', '/workspaces'];
const marker = randomUUID();

/**
 * Runs a bounded Docker command; failures retain output for GitHub Actions diagnostics.
 */
function docker(args) {
  return execFileSync('docker', args, {
    env: environment,
    encoding: 'utf8',
    timeout: 720_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

/**
 * Always addresses the isolated smoke project rather than any existing deployment.
 */
function compose(...args) {
  return docker([...composeArgs, ...args]);
}

/**
 * Verifies both the CLI readiness contract and actual static Web serving on the published port.
 */
async function verifyWeb() {
  compose('exec', '-T', 'dr-octopus', 'dr-octopus', 'gateway', 'health', '--json');
  const address = compose('port', 'dr-octopus', '3000');
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const response = await fetch(`http://${address}`, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<!doctype html/i);
}

try {
  console.log('Checking image identity, platform and runtime user...');
  const [details] = JSON.parse(docker(['image', 'inspect', reference]));
  assert.equal(details.Os, 'linux');
  assert.equal(details.Architecture, 'amd64');
  assert.equal(details.Config.User, 'node');
  const labels = details.Config.Labels;
  assert.equal(labels['org.opencontainers.image.version'], process.env.EXPECTED_VERSION);
  assert.equal(labels['org.opencontainers.image.revision'], process.env.EXPECTED_COMMIT);
  assert.equal(labels['com.nebulaedata.dr-octopus.image-revision'], process.env.IMAGE_REVISION ?? '0');
  assert.equal(
    docker(['run', '--rm', '--entrypoint', 'dr-octopus', reference, '--version']),
    process.env.EXPECTED_VERSION
  );
  console.log('Starting the isolated Compose deployment and waiting for readiness...');
  compose('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '660');
  await verifyWeb();
  compose(
    'exec',
    '-T',
    'dr-octopus',
    'node',
    '-e',
    `const fs=require('node:fs'); for(const root of ${JSON.stringify(roots)}) fs.writeFileSync(root+'/.docker-smoke', ${JSON.stringify(marker)});`
  );
  console.log('Recreating the container to verify Web readiness and persistent volume contents...');
  compose('up', '-d', '--force-recreate', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '660');
  await verifyWeb();
  compose(
    'exec',
    '-T',
    'dr-octopus',
    'node',
    '-e',
    `const fs=require('node:fs'), assert=require('node:assert/strict'); for(const root of ${JSON.stringify(roots)}) assert.equal(fs.readFileSync(root+'/.docker-smoke','utf8'), ${JSON.stringify(marker)});`
  );
  console.log('Image version, readiness, Web and all three persistent volumes verified.');
} catch (error) {
  console.error(error.stdout?.toString() ?? '', error.stderr?.toString() ?? '');
  try {
    console.error(compose('logs', '--no-color', '--tail', '150'));
  } catch {
    /* Preserve the original failure. */
  }
  throw error;
} finally {
  // Only this randomly named test project is removed, never the user's dr-octopus project.
  try {
    compose('down', '--volumes', '--remove-orphans');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
