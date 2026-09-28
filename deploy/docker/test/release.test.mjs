/**
 * @author Codex
 * @description Guards version identity, Docker Hub failure handling, promotion ordering and the user installer contract.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { image, prepareInstaller, registryDigest, releaseIdentity, shouldPromote } from '../release.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const hasCompose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

/**
 * Produces disposable installer directories without modifying a developer's configuration.
 */
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'octopus-installer-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('exact versions and image revisions have distinct identities', () => {
  assert.deepEqual(releaseIdentity('v0.0.10', '2'), {
    tag: 'v0.0.10',
    version: '0.0.10',
    revision: '2',
    imageTag: '0.0.10-r2',
    prerelease: false,
  });
  assert.equal(releaseIdentity('v1.0.0-rc.1').prerelease, true);
  assert.equal(releaseIdentity('v0.0.10').imageTag, '0.0.10');
});

test('rejects tags, ranges, invalid SemVer and shell/path input before side effects', () => {
  for (const tag of [
    'latest',
    'main',
    '0.0.10',
    'v01.2.3',
    'v1.2',
    'v1.2.3+build',
    'v1.2.3-01',
    'v1.2.3\n',
    'v1.2.3\nBAD=1',
    'v1.2.3;echo bad',
    '../v1.2.3',
  ])
    assert.throws(() => releaseIdentity(tag));
  for (const revision of ['-1', '01', '1.2', '1\n', '1\nBAD=1', '$(command)'])
    assert.throws(() => releaseIdentity('v1.2.3', revision));
  assert.throws(() => releaseIdentity(`v1.2.3-${'a'.repeat(128)}`));
});

test('latest advances numerically and never regresses during old release retries', () => {
  const current = { version: '1.9.0', revision: '2' };
  assert.equal(shouldPromote(releaseIdentity('v1.10.0'), current), true);
  assert.equal(shouldPromote(releaseIdentity('v1.9.0', '3'), current), true);
  assert.equal(shouldPromote(releaseIdentity('v1.9.0', '2'), current), false);
  assert.equal(shouldPromote(releaseIdentity('v1.9.0'), current), false);
  assert.equal(shouldPromote(releaseIdentity('v1.8.0', '99'), current), false);
  assert.equal(shouldPromote(releaseIdentity('v2.0.0-rc.1'), current), false);
  assert.equal(shouldPromote(releaseIdentity('v2.0.0-rc.1'), null), false);
  assert.equal(shouldPromote(releaseIdentity('v1.0.0'), null), true);
  assert.throws(() => shouldPromote(releaseIdentity('v2.0.0'), { version: 'broken', revision: '0' }));
});

/**
 * Substitutes the registry transport, preserving the real status/digest handling without network traffic.
 */
function registryResponse(status, digest) {
  return async (url, options) => {
    if (url.startsWith('https://auth.docker.io/'))
      return new Response(JSON.stringify({ token: 'test-token' }));
    assert.equal(options.method, 'HEAD');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return new Response(null, { status, headers: digest ? { 'docker-content-digest': digest } : {} });
  };
}

test('existing immutable tags resolve to digests; only 404 permits a new build', async () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  assert.equal(await registryDigest('1.0.0', registryResponse(200, digest)), digest);
  assert.equal(await registryDigest('1.0.0', registryResponse(404)), null);
});

test('registry failures cannot silently authorize overwriting a tag', async () => {
  for (const status of [401, 403, 429, 500, 503])
    await assert.rejects(registryDigest('1.0.0', registryResponse(status)), /lookup failed/);
  await assert.rejects(registryDigest('1.0.0', registryResponse(200, 'bad')), /invalid digest/);
  await assert.rejects(
    registryDigest('1.0.0', async () => new Response(null, { status: 503 })),
    /token request failed/
  );
  await assert.rejects(
    registryDigest('1.0.0', async () => {
      throw new Error('offline');
    }),
    /offline/
  );
});

test('installer contains only public installation files and pins the image revision', (t) => {
  const directory = temporary(t);
  prepareInstaller(source, directory, releaseIdentity('v1.2.3', '2'));
  assert.deepEqual(
    readdirSync(directory).sort(),
    ['.env.example', 'README.md', 'README.zh-CN.md', 'compose.yaml'].sort()
  );
  assert.match(readFileSync(join(directory, '.env.example'), 'utf8'), /^IMAGE_TAG=1\.2\.3-r2$/m);
  assert.equal(
    readFileSync(join(directory, 'compose.yaml'), 'utf8'),
    readFileSync(join(source, 'compose.yaml'), 'utf8')
  );
});

test(
  'public Compose installs prebuilt images with external access and existing volume identities',
  { skip: !hasCompose && 'Docker Compose CLI is unavailable' },
  (t) => {
    const directory = temporary(t);
    prepareInstaller(source, directory, releaseIdentity('v1.2.3', '1'));
    const env = { ...process.env };
    for (const name of [
      'IMAGE_TAG',
      'IMAGE_REPOSITORY',
      'BIND_ADDRESS',
      'HTTP_PORT',
      'SERVER_CORS_ORIGIN',
      'COMPOSE_PROJECT_NAME',
      'LOG_LEVEL',
      'NPM_CONFIG_REGISTRY',
    ])
      delete env[name];
    const args = [
      'compose',
      '--env-file',
      join(directory, '.env.example'),
      '-f',
      join(directory, 'compose.yaml'),
      'config',
      '--format',
      'json',
    ];
    const config = JSON.parse(execFileSync('docker', args, { encoding: 'utf8', env }));
    const service = config.services['dr-octopus'];
    assert.equal(config.name, 'dr-octopus');
    assert.equal(service.image, `${image}:1.2.3-r1`);
    assert.equal(service.build, undefined);
    assert.equal(service.ports[0].host_ip, '0.0.0.0');
    assert.equal(service.ports[0].target, 3000);
    assert.equal(service.environment.SERVER_HOST, '0.0.0.0');
    assert.equal(service.environment.NPM_CONFIG_REGISTRY, 'https://registry.npmjs.org');
    for (const name of ['server-data', 'agent-data', 'workspaces'])
      assert.equal(config.volumes[name].name, `dr-octopus_${name}`);
    assert.deepEqual(service.volumes.map((volume) => volume.target).sort(), [
      '/home/node/.dr-octopus/agent',
      '/home/node/.dr-octopus/server',
      '/workspaces',
    ]);
    writeFileSync(
      join(directory, '.env.example'),
      'IMAGE_TAG=1.2.3-r1\nNPM_CONFIG_REGISTRY=https://registry.npmmirror.com\n'
    );
    const mirrored = JSON.parse(execFileSync('docker', args, { encoding: 'utf8', env }));
    assert.equal(
      mirrored.services['dr-octopus'].environment.NPM_CONFIG_REGISTRY,
      'https://registry.npmmirror.com'
    );
    assert.equal(mirrored.services['dr-octopus'].image, service.image);
    writeFileSync(join(directory, '.env.example'), 'IMAGE_TAG=1.2.3-r1\nNPM_CONFIG_REGISTRY=\n');
    const empty = JSON.parse(execFileSync('docker', args, { encoding: 'utf8', env }));
    assert.equal(empty.services['dr-octopus'].environment.NPM_CONFIG_REGISTRY, 'https://registry.npmjs.org');
    writeFileSync(
      join(directory, '.env.example'),
      'IMAGE_TAG=latest\nIMAGE_REPOSITORY=harbor.n.nebulaedata.com/nebulae/dr-octopus\n'
    );
    const internal = JSON.parse(execFileSync('docker', args, { encoding: 'utf8', env }));
    assert.equal(internal.services['dr-octopus'].image, 'harbor.n.nebulaedata.com/nebulae/dr-octopus:latest');
    assert.deepEqual(internal.volumes, config.volumes);
    assert.deepEqual(internal.services['dr-octopus'].volumes, service.volumes);
    writeFileSync(join(directory, '.env.example'), '');
    const missing = spawnSync('docker', args, { encoding: 'utf8', env });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /IMAGE_TAG/);
  }
);
