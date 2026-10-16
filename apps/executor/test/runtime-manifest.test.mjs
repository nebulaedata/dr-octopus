/**
 * @author Codex
 * @description Verifies complete release inventory rejection of corruption, added files, links, invalid paths and inconsistent build identity using isolated deterministic files.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createRuntimeManifest, verifyRuntimeManifest } from '../scripts/lib/package/runtime-manifest.mjs';

const schemaBytes = '{}';
const schemaDigest = createHash('sha256').update(schemaBytes).digest('hex');
const metadata = {
  product: { name: 'Dr.Octopus Executor', version: '0.0.1' },
  platform: 'win32',
  arch: 'x64',
  components: {
    electron: { version: '44.4.5', node: '24.20.0', moduleAbi: '150' },
    privateNode: '24.20.0',
    privatePython: '3.14.0',
    systemShell: { kind: 'powershell', versionFamily: '5.1', source: 'operating-system' },
    fd: '10.5.0',
    rg: '15.2.0',
    pageController: '1.12.4',
    windowsMcp: { version: '0.8.6', commit: 'a'.repeat(40) },
  },
  entries: { runtime: 'runtime.cjs' },
  schemas: [{ path: 'schemas.json', sha256: schemaDigest }],
  licenses: ['LICENSE'],
  basicBuildId: 'b'.repeat(64),
  tools: {
    basic: Array.from({ length: 7 }, (_, i) => `basic_${i}`),
    browser: Array.from({ length: 11 }, (_, i) => `browser_${i}`),
    control: Array.from({ length: 5 }, (_, i) => `control_${i}`),
    computerPrepared: Array.from({ length: 8 }, (_, i) => `computer_${i}`),
  },
  availability: {
    computerEnabled: true,
    browserRequiresConnectionAndGrant: true,
    shellNode: false,
    npmBundled: false,
  },
};

/**
 * Owns one fixture tree and deletes only its verified temporary prefix.
 */
async function fixture(run) {
  const prefix = resolve(tmpdir(), 'octopus-manifest-');
  const root = await mkdtemp(prefix);
  try {
    await writeFile(join(root, 'runtime.cjs'), 'fixed product');
    await writeFile(join(root, 'schemas.json'), schemaBytes);
    await writeFile(join(root, 'LICENSE'), 'fixture license');
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested/notice.txt'), 'notice');
    await run(root);
  } finally {
    assert.ok(resolve(root).startsWith(prefix));
    await rm(root, { recursive: true, force: true });
  }
}

test('release identity is reproducible and verifier rejects changed, missing and extra product bytes', async () => {
  await fixture(async (root) => {
    const manifest = await createRuntimeManifest(root, metadata);
    assert.equal(manifest.productBuildId, (await createRuntimeManifest(root, metadata)).productBuildId);
    assert.equal((await verifyRuntimeManifest(root, manifest)).files, 4);
    await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify(manifest));
    assert.equal((await verifyRuntimeManifest(root, manifest)).files, 4);
    await writeFile(join(root, 'runtime.cjs'), 'fixed corrupt');
    await assert.rejects(verifyRuntimeManifest(root, manifest), /RELEASE_INVENTORY_MISMATCH/);
    await writeFile(join(root, 'runtime.cjs'), 'fixed product');
    await writeFile(join(root, 'extra.exe'), 'unexpected');
    await assert.rejects(verifyRuntimeManifest(root, manifest), /RELEASE_INVENTORY_MISMATCH/);
    await rm(join(root, 'extra.exe'));
    await rm(join(root, 'nested/notice.txt'));
    await assert.rejects(verifyRuntimeManifest(root, manifest), /RELEASE_INVENTORY_MISMATCH/);
  });
});

test('manifest rejects traversal, missing references, modified metadata, duplicate inventory and false availability', async () => {
  await fixture(async (root) => {
    const manifest = await createRuntimeManifest(root, metadata);
    for (const mutation of [
      { entries: { runtime: '../runtime.cjs' } },
      { entries: { runtime: 'missing.cjs' } },
      { files: [...manifest.files, manifest.files[0]] },
      { availability: { ...manifest.availability, computerEnabled: false } },
      { availability: { ...manifest.availability, shellNode: true, npmBundled: true } },
      { productBuildId: 'c'.repeat(64) },
      { components: { ...manifest.components, privateNode: 'fake-version' } },
    ]) {
      await assert.rejects(verifyRuntimeManifest(root, { ...manifest, ...mutation }));
    }
  });
});

test('inventory rejects a junction and a root alias without reading its external target', async () => {
  await fixture(async (root) => {
    const target = join(root, 'nested');
    const alias = join(root, 'alias');
    await symlink(target, alias, 'junction');
    await assert.rejects(createRuntimeManifest(root, metadata), /RELEASE_LINK_REJECTED/);
    await assert.rejects(createRuntimeManifest(alias, metadata), /RELEASE_ROOT_ALIAS/);
    await rm(alias);
  });
});

test('new npm metadata requires component and complete entry references while legacy bridge-only manifests still verify', async () => {
  await fixture(async (root) => {
    const legacy = await createRuntimeManifest(root, metadata);
    await verifyRuntimeManifest(root, legacy);
    const updated = {
      ...metadata,
      components: { ...metadata.components, npm: '11.19.0' },
      entries: {
        ...metadata.entries,
        node: 'runtime.cjs',
        npm: 'runtime.cjs',
        npx: 'runtime.cjs',
        nodeInventory: 'runtime.cjs',
      },
      availability: { ...metadata.availability, shellNode: true, npmBundled: true },
    };
    await verifyRuntimeManifest(root, await createRuntimeManifest(root, updated));
    await assert.rejects(createRuntimeManifest(root, { ...updated, entries: metadata.entries }));
    await assert.rejects(createRuntimeManifest(root, { ...updated, components: metadata.components }));
  });
});
