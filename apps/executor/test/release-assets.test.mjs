/**
 * @author Codex
 * @description Verifies exact-source Release promotion, staged integrity, collision refusal and partial-upload recovery.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareReleaseAssets, publishReleaseAssets } from '../scripts/lib/package/release-assets.mjs';

const identity = { repository: 'nebulaedata/dr-octopus', tag: 'v0.0.13', sourceCommit: 'a'.repeat(40) };
const stem = 'Dr.Octopus-Executor-0.0.1-win-x64-unsigned';

/**
 * Computes deterministic fixture digests without using production helper internals.
 */
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Owns a small verified delivery and all generated metadata in one disposable directory.
 */
async function fixture(run, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-release-'));
  const directory = join(root, 'delivery');
  await mkdir(join(directory, 'verification'), { recursive: true });
  const contents = { [`${stem}.exe`]: 'installer fixture', [`${stem}.zip`]: 'archive fixture' };
  const files = Object.entries(contents).map(([path, bytes]) => ({
    path,
    size: Buffer.byteLength(bytes),
    sha256: digest(bytes),
  }));
  contents['acceptance-artifacts.json'] = JSON.stringify({
    version: '0.0.1',
    signed: false,
    productBuildId: 'b'.repeat(64),
    files,
    ...overrides.metadata,
  });
  contents['BUILD-INFO.json'] = JSON.stringify({
    schemaVersion: 1,
    repository: identity.repository,
    sourceCommit: identity.sourceCommit,
    sourceRef: `refs/tags/${identity.tag}`,
    event: 'release',
    version: '0.0.1',
    signed: false,
    productBuildId: 'b'.repeat(64),
    artifacts: files,
    verification: { packageTestsPassed: 6, zipInventory: 'passed', stagedArtifacts: 'passed' },
    ...overrides.provenance,
  });
  contents['verification/zip-inventory.json'] = JSON.stringify({ passed: true });
  for (const [name, bytes] of Object.entries(contents)) {
    await writeFile(join(directory, name), bytes);
  }
  await writeFile(
    join(directory, 'SHA256SUMS.txt'),
    Object.entries(contents)
      .map(([name, bytes]) => `${digest(bytes)}  ${name}\n`)
      .join('')
  );
  try {
    await run(directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Models published assets and GitHub's tag/asset contracts while consuming real upload streams.
 */
function github({ commit = identity.sourceCommit, failOnce = false, assets = [], draft = false } = {}) {
  const uploaded = [...assets];
  const posts = [];
  let fail = failOnce;
  return {
    uploaded,
    posts,
    /**
     * Refuses unexpected API operations so tests cannot hide tag creation, deletion or replacement.
     */
    async request(input, options) {
      const url = new URL(input);
      assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      if (options.method === 'POST') {
        assert.equal(url.origin, 'https://uploads.github.com');
        const name = url.searchParams.get('name');
        posts.push(name);
        const chunks = [];
        for await (const chunk of options.body) {
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        assert.equal(Number(options.headers['Content-Length']), bytes.length);
        if (fail && name.endsWith('.zip')) {
          fail = false;
          return new Response('', { status: 500 });
        }
        const asset = { name, state: 'uploaded', size: bytes.length, digest: `sha256:${digest(bytes)}` };
        uploaded.push(asset);
        return Response.json(asset);
      }
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(options.method, undefined);
      if (url.pathname.endsWith(`/releases/tags/${identity.tag}`)) {
        return Response.json({
          id: 42,
          draft,
          tag_name: identity.tag,
          html_url: 'https://github.com/nebulaedata/dr-octopus/releases/tag/v0.0.13',
          upload_url:
            'https://uploads.github.com/repos/nebulaedata/dr-octopus/releases/42/assets{?name,label}',
        });
      }
      if (url.pathname.endsWith(`/git/ref/tags/${identity.tag}`)) {
        return Response.json({ object: { type: 'tag', sha: 'c'.repeat(40) } });
      }
      if (url.pathname.endsWith(`/git/tags/${'c'.repeat(40)}`)) {
        return Response.json({ object: { type: 'commit', sha: commit } });
      }
      if (url.pathname.endsWith('/releases/42/assets')) {
        return Response.json(uploaded);
      }
      assert.fail(`Unexpected API operation: ${url.pathname}`);
    },
  };
}

test('verified delivery produces five exact Release assets with independently versioned filenames', async () => {
  await fixture(async (directory) => {
    const before = await readFile(join(directory, 'SHA256SUMS.txt'));
    const prepared = await prepareReleaseAssets(directory, identity);
    assert.equal(prepared.assets.length, 5);
    assert.deepEqual(
      prepared.assets.map((file) => file.name),
      [
        `${stem}.exe`,
        `${stem}.zip`,
        `${stem}-BUILD-INFO.json`,
        `${stem}-acceptance-artifacts.json`,
        `${stem}-SHA256SUMS.txt`,
      ]
    );
    for (const asset of prepared.assets) {
      assert.equal(digest(await readFile(asset.path)), asset.sha256);
    }
    const sums = await readFile(prepared.assets[4].path, 'utf8');
    for (const asset of prepared.assets.slice(0, 4)) {
      assert.ok(sums.includes(`${asset.sha256}  ${asset.name}\n`));
    }
    assert.deepEqual(await readFile(join(directory, 'SHA256SUMS.txt')), before);
    assert.equal((await readdir(directory)).length, 6);
  });
});

test('changed bytes, omitted files and unsafe checksum paths are rejected before publication', async (t) => {
  for (const kind of ['installer', 'report', 'extra', 'traversal']) {
    await t.test(kind, async () =>
      fixture(async (directory) => {
        if (kind === 'installer') {
          await writeFile(join(directory, `${stem}.exe`), 'changed');
        }
        if (kind === 'report') {
          await writeFile(join(directory, 'verification/zip-inventory.json'), 'changed');
        }
        if (kind === 'extra') {
          await writeFile(join(directory, 'extra.txt'), 'unexpected');
        }
        if (kind === 'traversal') {
          await writeFile(join(directory, 'SHA256SUMS.txt'), `${'a'.repeat(64)}  ../outside\n`);
        }
        await assert.rejects(
          prepareReleaseAssets(directory, identity),
          /digest mismatch|inventory is incomplete|Unsafe/
        );
      })
    );
  }
});

test('wrong source, branch artifacts, incomplete verification and false signing claims cannot be promoted', async (t) => {
  for (const provenance of [
    { sourceCommit: 'd'.repeat(40) },
    { sourceRef: 'refs/heads/main' },
    { verification: { packageTestsPassed: 5 } },
    { signed: true },
  ]) {
    await t.test(JSON.stringify(provenance), async () =>
      fixture(
        async (directory) => {
          await assert.rejects(prepareReleaseAssets(directory, identity), /provenance|verification|identity/);
        },
        { provenance }
      )
    );
  }
});

test('partial publication resumes identical bytes and a completed retry performs no uploads', async () => {
  await fixture(async (directory) => {
    const delivery = await prepareReleaseAssets(directory, identity);
    const api = github({ failOnce: true });
    const options = { token: 'fixture-token', request: api.request };
    await assert.rejects(publishReleaseAssets(delivery, options), /HTTP 500/);
    assert.deepEqual(api.posts, [`${stem}.exe`, `${stem}.zip`]);
    const resumed = await publishReleaseAssets(delivery, options);
    assert.equal(resumed.uploaded.length, 4);
    assert.equal(resumed.retained, 1);
    const complete = await publishReleaseAssets(delivery, options);
    assert.equal(complete.uploaded.length, 0);
    assert.equal(complete.retained, 5);
    assert.equal(api.uploaded.length, 5);
    assert.equal(api.posts.filter((name) => name.endsWith('.exe')).length, 1);
  });
});

test('retagging, drafts and conflicting assets stop before uploading any new file', async (t) => {
  for (const kind of ['tag', 'draft', 'collision']) {
    await t.test(kind, async () =>
      fixture(async (directory) => {
        const delivery = await prepareReleaseAssets(directory, identity);
        const options = {};
        if (kind === 'tag') {
          options.commit = 'e'.repeat(40);
        }
        if (kind === 'draft') {
          options.draft = true;
        }
        if (kind === 'collision') {
          options.assets = [
            {
              name: `${stem}.zip`,
              state: 'uploaded',
              size: delivery.assets[1].size,
              digest: `sha256:${'f'.repeat(64)}`,
            },
          ];
        }
        const api = github(options);
        await assert.rejects(
          publishReleaseAssets(delivery, { token: 'fixture-token', request: api.request }),
          /source commit|published target|conflicts/
        );
        assert.deepEqual(api.posts, []);
      })
    );
  }
});
