/**
 * @author Codex
 * @description Regresses build-only identity resolution, official channel origins and stale or mixed artifact rejection using isolated fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  loadBrowserIdentity,
  loadBrowserExtensionBuild,
  parseBrowserIdentity,
  resolveBrowserIdentity,
  resolveBrowserExtensionBuild,
} from '../../browser-extension/scripts/lib/browser-identity.mjs';
import { bridgeVersion } from '@octopus/shared/protocol/browser-bridge';
import {
  verifyBuiltBrowserIdentity,
  verifyBundledBrowserExtensions,
  browserIdentityModule,
} from '../scripts/lib/compile/browser-identity.mjs';

const publicConfiguration = JSON.parse(
  await readFile(new URL('../../browser-extension/browser-identity.json', import.meta.url), 'utf8')
);
const chromeId = 'b'.repeat(32);
const edgeId = 'c'.repeat(32);
const configuration = {
  ...publicConfiguration,
  stores: { chromeExtensionId: chromeId, edgeExtensionId: edgeId },
};

test('versioned official configuration alone supplies all three identities', () => {
  const identity = loadBrowserIdentity();
  assert.equal('profile' in identity, false);
  assert.equal(identity.chromeExtensionId, publicConfiguration.stores.chromeExtensionId);
  assert.equal(identity.edgeExtensionId, publicConfiguration.stores.edgeExtensionId);
  assert.equal(identity.allowedOrigins.length, 3);
  assert.throws(() => identity.allowedOrigins.push('chrome-extension://unknown/'), TypeError);
  assert.equal(parseBrowserIdentity(JSON.parse(JSON.stringify(identity))).fingerprint, identity.fingerprint);
});

test('product versions and plugin profiles do not change the official policy or generated client module', () => {
  const identity = resolveBrowserIdentity(configuration);
  for (const profile of ['sideload', 'store']) {
    for (const version of ['0.1.0', '0.2.0']) {
      const build = resolveBrowserExtensionBuild(configuration, profile, version);
      assert.deepEqual(build.identity, identity);
      assert.equal(browserIdentityModule(build.identity), browserIdentityModule(identity));
    }
  }
  assert.equal(
    resolveBrowserIdentity({
      ...configuration,
      stores: { chromeExtensionId: chromeId, edgeExtensionId: chromeId },
    }).allowedOrigins.length,
    2
  );
  assert.throws(
    () => resolveBrowserExtensionBuild(configuration, 'production', '0.1.0'),
    /BROWSER_IDENTITY_PROFILE/
  );
});

test('missing or invalid store identities fail in every mode instead of falling back to the sideload ID', () => {
  for (const field of ['chromeExtensionId', 'edgeExtensionId']) {
    for (const invalid of [
      undefined,
      '',
      '*',
      'chrome-extension://' + chromeId + '/',
      'A'.repeat(32),
      'a'.repeat(31),
      '12345678-1234-1234-1234-123456789012',
    ]) {
      const broken = { ...configuration, stores: { ...configuration.stores, [field]: invalid } };
      assert.throws(() => resolveBrowserIdentity(broken));
      for (const profile of ['sideload', 'store']) {
        assert.throws(() => resolveBrowserExtensionBuild(broken, profile, '0.1.0'));
      }
    }
  }
});

test('plugin metadata must use a product version accepted by the runtime handshake', () => {
  for (const version of ['1', '1.2.3.4', '0.1.0-beta']) {
    assert.throws(() => resolveBrowserExtensionBuild(configuration, 'sideload', version));
  }
});

test('identity snapshots reject foreign origins, stale fingerprints and mismatched sideload keys', () => {
  const identity = resolveBrowserIdentity(configuration);
  assert.throws(
    () => parseBrowserIdentity({ ...identity, allowedOrigins: ['chrome-extension://' + chromeId + '/'] }),
    /origin set/
  );
  assert.throws(() => parseBrowserIdentity({ ...identity, fingerprint: '0'.repeat(64) }), /fingerprint/);
  assert.throws(
    () =>
      resolveBrowserIdentity({
        ...configuration,
        sideload: { ...configuration.sideload, extensionId: chromeId },
      }),
    /public key and extension ID/
  );
});

test('client ignores legacy process identity overrides and an invalid plugin profile', async () => {
  const module = new URL('../../browser-extension/scripts/lib/browser-identity.mjs', import.meta.url).href;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import {loadBrowserIdentity} from ' +
        JSON.stringify(module) +
        '; console.log(JSON.stringify(loadBrowserIdentity()));',
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        BROWSER_CHROME_EXTENSION_ID: 'd'.repeat(32),
        BROWSER_EDGE_EXTENSION_ID: '*',
        BROWSER_IDENTITY_PROFILE: 'invalid',
      },
    }
  );
  assert.deepEqual(JSON.parse(stdout), resolveBrowserIdentity(publicConfiguration));
});

test('only plugin mode reads .env; absent .env still builds both modes with the complete JSON policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-identity-env-'));
  try {
    const configurationPath = join(root, 'browser-identity.json');
    const environmentPath = join(root, '.env');
    await writeFile(configurationPath, JSON.stringify(configuration));
    const identity = loadBrowserIdentity({ configurationPath });
    for (const profile of ['sideload', 'store']) {
      const build = loadBrowserExtensionBuild({
        configurationPath,
        environmentPath,
        environment: { BROWSER_IDENTITY_PROFILE: profile },
      });
      assert.deepEqual(build.identity, identity);
      assert.equal(build.profile, profile);
    }
    assert.equal(
      loadBrowserExtensionBuild({ configurationPath, environmentPath, environment: {} }).profile,
      'sideload'
    );
    await writeFile(
      environmentPath,
      'BROWSER_IDENTITY_PROFILE=store\nBROWSER_CHROME_EXTENSION_ID=' +
        'd'.repeat(32) +
        '\nBROWSER_EDGE_EXTENSION_ID=*\nIDENTITY_TEST_UNRELATED_SECRET=not-a-real-secret\n'
    );
    const fromFile = loadBrowserExtensionBuild({ configurationPath, environmentPath, environment: {} });
    assert.equal(fromFile.profile, 'store');
    assert.deepEqual(fromFile.identity, identity);
    const overridden = loadBrowserExtensionBuild({
      configurationPath,
      environmentPath,
      environment: { BROWSER_IDENTITY_PROFILE: 'sideload', BROWSER_CHROME_EXTENSION_ID: 'e'.repeat(32) },
    });
    assert.equal(overridden.profile, 'sideload');
    assert.deepEqual(overridden.identity, identity);
    assert.equal('IDENTITY_TEST_UNRELATED_SECRET' in overridden, false);
    assert.equal(process.env.IDENTITY_TEST_UNRELATED_SECRET, undefined);
    // The client remains usable even when the plugin environment source is unreadable as a file.
    assert.deepEqual(loadBrowserIdentity({ configurationPath }), identity);
    assert.throws(() =>
      loadBrowserExtensionBuild({ configurationPath, environmentPath: root, environment: {} })
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Supplies completed client bytes before any plugin exists, then writes independently replaceable artifacts.
 */
async function deliveryFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-identity-artifacts-'));
  const executor = join(root, 'executor');
  const extensions = join(root, 'extensions');
  const identity = resolveBrowserIdentity(configuration);
  const artifacts = {};
  try {
    for (const relative of [
      'native/browser-launcher.exe',
      'bridge/native-host.cjs',
      'runtime/index.cjs',
      'setup/register-browser-host.ps1',
    ]) {
      const destination = join(executor, relative);
      await mkdir(dirname(destination), { recursive: true });
      const bytes = Buffer.from('isolated fixture for ' + relative);
      await writeFile(destination, bytes);
      artifacts[relative] = createHash('sha256').update(bytes).digest('hex');
    }
    const snapshot = { identity, protocolVersion: bridgeVersion, artifacts };
    await writeFile(join(executor, 'browser-identity.json'), JSON.stringify(snapshot));
    /**
     * Publishes one plugin's matching manifest and build record without rewriting client files.
     */
    const publish = async (flavor, profile = 'sideload', version = '0.1.0', overrides = {}) => {
      const directory = join(extensions, flavor + '-mv3');
      await mkdir(directory, { recursive: true });
      const build = resolveBrowserExtensionBuild(
        { ...configuration, stores: { ...configuration.stores, ...overrides } },
        profile,
        version
      );
      await writeFile(join(directory, 'browser-identity.json'), JSON.stringify(build));
      await writeFile(
        join(directory, 'manifest.json'),
        JSON.stringify({
          version,
          ...(profile === 'sideload' ? { key: build.identity.sideloadPublicKey } : {}),
        })
      );
      return { directory, build };
    };
    await run({ executor, extensions, identity, snapshot, publish });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('client verification needs no plugin output; plugin mode and version changes do not rebuild client bytes', async () => {
  await deliveryFixture(async ({ executor, extensions, identity, publish }) => {
    const original = await readFile(join(executor, 'browser-identity.json'));
    const client = await verifyBuiltBrowserIdentity(identity, executor);
    for (const profile of ['sideload', 'store']) {
      for (const version of ['0.1.0', '0.2.0']) {
        for (const flavor of ['chrome', 'edge']) {
          await publish(flavor, profile, version);
        }
        await verifyBundledBrowserExtensions(client, extensions);
        assert.deepEqual(await readFile(join(executor, 'browser-identity.json')), original);
      }
    }
    // Unrelated channel configuration in a sideload artifact cannot change its actual admitted identity.
    for (const flavor of ['chrome', 'edge']) {
      await publish(flavor, 'sideload', '0.1.0', {
        chromeExtensionId: 'd'.repeat(32),
        edgeExtensionId: 'e'.repeat(32),
      });
    }
    await verifyBundledBrowserExtensions(client, extensions);
  });
});

test('independent client changes preserve compatible plugin artifacts and reject stale client policy or protocol', async () => {
  await deliveryFixture(async ({ executor, extensions, identity, snapshot, publish }) => {
    for (const flavor of ['chrome', 'edge']) {
      await publish(flavor);
    }
    const original = await readFile(join(extensions, 'chrome-mv3/browser-identity.json'));
    await writeFile(join(executor, 'runtime/index.cjs'), 'new compatible client implementation');
    await assert.rejects(verifyBuiltBrowserIdentity(identity, executor), /consumer changed/);
    snapshot.artifacts['runtime/index.cjs'] = createHash('sha256')
      .update('new compatible client implementation')
      .digest('hex');
    await writeFile(join(executor, 'browser-identity.json'), JSON.stringify(snapshot));
    await verifyBundledBrowserExtensions(await verifyBuiltBrowserIdentity(identity, executor), extensions);
    assert.deepEqual(await readFile(join(extensions, 'chrome-mv3/browser-identity.json')), original);
    await assert.rejects(
      verifyBuiltBrowserIdentity(
        resolveBrowserIdentity({
          ...configuration,
          stores: { ...configuration.stores, chromeExtensionId: 'd'.repeat(32) },
        }),
        executor
      ),
      /identity is stale/
    );
    await writeFile(
      join(executor, 'browser-identity.json'),
      JSON.stringify({ ...snapshot, protocolVersion: bridgeVersion + 1 })
    );
    await assert.rejects(verifyBuiltBrowserIdentity(identity, executor), /protocol is stale/);
  });
});

test('bundled plugins reject unapproved channel identities, incompatible protocols and changed manifest metadata', async () => {
  await deliveryFixture(async ({ executor, extensions, identity, publish }) => {
    const client = await verifyBuiltBrowserIdentity(identity, executor);
    await publish('edge', 'store');
    await publish('chrome', 'store', '0.1.0', { chromeExtensionId: 'd'.repeat(32) });
    await assert.rejects(verifyBundledBrowserExtensions(client, extensions), /identity is not allowed/);
    const { directory, build } = await publish('chrome', 'store');
    await writeFile(
      join(directory, 'browser-identity.json'),
      JSON.stringify({ ...build, protocolVersion: bridgeVersion + 1 })
    );
    await assert.rejects(verifyBundledBrowserExtensions(client, extensions), /protocol is incompatible/);
    await publish('chrome', 'store');
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: '0.9.0' }));
    await assert.rejects(verifyBundledBrowserExtensions(client, extensions), /version differs/);
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ version: '0.1.0', key: identity.sideloadPublicKey })
    );
    await assert.rejects(verifyBundledBrowserExtensions(client, extensions), /must not carry/);
    await publish('chrome', 'sideload');
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: '0.1.0' }));
    await assert.rejects(verifyBundledBrowserExtensions(client, extensions), /sideload manifest key/);
    await publish('chrome', 'sideload');
    await writeFile(join(directory, 'browser-identity.json'), JSON.stringify({ ...build, unexpected: true }));
    await assert.rejects(verifyBundledBrowserExtensions(client, extensions));
  });
});
