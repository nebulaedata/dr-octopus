/**
 * @author Codex
 * @description Promotes a verified Executor delivery to its exact GitHub Release without replacing published bytes.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Hashes large installers and archives without loading their complete contents into memory.
 */
async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/**
 * Enumerates only ordinary delivery files and refuses links before following any directory.
 */
async function deliveryFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await deliveryFiles(directory, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error('Release delivery must contain only ordinary files and directories.');
    }
  }
  return files;
}

/**
 * Validates every staged checksum and CI provenance, then selects only the two public binary downloads.
 * The original verified delivery is never modified. Executor and repository release versions remain independent.
 */
export async function prepareReleaseAssets(directory, { repository, tag, sourceCommit }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)) {
    throw new Error('Expected a repository and an explicit version Release tag.');
  }
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('Expected the built source commit.');
  }
  const root = resolve(directory);
  if ((await realpath(root)) !== root) {
    throw new Error('Release delivery root must not be an alias.');
  }
  const files = await deliveryFiles(root);
  const checksums = new Map();
  for (const line of (await readFile(join(root, 'SHA256SUMS.txt'), 'utf8')).trimEnd().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
    if (!match) {
      throw new Error('Invalid delivery checksum entry.');
    }
    const [, digest, name] = match;
    if (
      name.includes('\\') ||
      name.split('/').some((part) => !part || part === '.' || part === '..') ||
      name.startsWith('/') ||
      name.includes(':') ||
      checksums.has(name)
    ) {
      throw new Error('Unsafe or duplicate delivery checksum path.');
    }
    checksums.set(name, digest);
  }
  const expectedFiles = files.filter((name) => name !== 'SHA256SUMS.txt').sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify([...checksums.keys()].sort())) {
    throw new Error('Delivery checksum inventory is incomplete.');
  }
  for (const [name, expected] of checksums) {
    if ((await fileDigest(join(root, name))) !== expected) {
      throw new Error(`Delivery digest mismatch: ${name}`);
    }
  }
  const metadata = JSON.parse(await readFile(join(root, 'acceptance-artifacts.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(join(root, 'BUILD-INFO.json'), 'utf8'));
  if (
    provenance.schemaVersion !== 1 ||
    provenance.repository !== repository ||
    provenance.sourceCommit !== sourceCommit ||
    provenance.sourceRef !== `refs/tags/${tag}` ||
    !['release', 'workflow_dispatch'].includes(provenance.event)
  ) {
    throw new Error('Delivery provenance does not match the target Release source.');
  }
  if (
    metadata.signed !== false ||
    provenance.signed !== false ||
    !/^[a-f0-9]{64}$/.test(metadata.productBuildId) ||
    provenance.productBuildId !== metadata.productBuildId ||
    provenance.version !== metadata.version ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version)
  ) {
    throw new Error('Expected a consistent unsigned Executor product identity.');
  }
  if (
    provenance.verification?.packageTestsPassed !== 6 ||
    provenance.verification.zipInventory !== 'passed' ||
    provenance.verification.stagedArtifacts !== 'passed'
  ) {
    throw new Error('Release delivery has not completed all required CI verification.');
  }
  const productStem = `Dr.Octopus-Executor-${metadata.version}-win-x64`;
  if (
    !Array.isArray(metadata.files) ||
    metadata.files.length !== 2 ||
    !Array.isArray(provenance.artifacts) ||
    provenance.artifacts.length !== 2
  ) {
    throw new Error('Expected exactly one installer and one ZIP.');
  }
  const assets = [];
  for (const extension of ['exe', 'zip']) {
    const variant = extension === 'exe' ? 'setup' : 'unpacked';
    const name = `${productStem}-${variant}-unsigned.${extension}`;
    const file = metadata.files.find((entry) => entry.path === name);
    const record = provenance.artifacts.find((entry) => entry.path === name);
    const path = join(root, name);
    const size = (await lstat(path)).size;
    if (
      !file ||
      !record ||
      file.sha256 !== checksums.get(name) ||
      record.sha256 !== file.sha256 ||
      file.size !== size ||
      record.size !== size
    ) {
      throw new Error(`Release artifact metadata mismatch: ${name}`);
    }
    assets.push({ name, path, size, sha256: file.sha256 });
  }
  return { repository, tag, sourceCommit, productBuildId: metadata.productBuildId, assets };
}

/**
 * Uploads only to an existing published Release whose tag still names the verified source commit.
 * Identical uploaded assets are retained; any conflicting asset fails before the first upload.
 * A failed upload is not replayed automatically; rerunning this job reconciles GitHub's actual asset digests.
 */
export async function publishReleaseAssets(delivery, { token, request = fetch }) {
  if (!token) {
    throw new Error('A GitHub token with Release contents write permission is required.');
  }
  const base = `https://api.github.com/repos/${delivery.repository}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  /**
   * Requires a successful GitHub JSON response without logging credentials or response bodies.
   */
  async function json(url, options = {}) {
    const response = await request(url, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) {
      throw new Error(`GitHub Release request failed: HTTP ${response.status}.`);
    }
    return response.json();
  }
  const release = await json(`${base}/releases/tags/${encodeURIComponent(delivery.tag)}`);
  if (release.draft !== false || release.tag_name !== delivery.tag) {
    throw new Error('Expected the existing published target Release.');
  }
  let reference = await json(`${base}/git/ref/tags/${encodeURIComponent(delivery.tag)}`);
  let object = reference.object;
  for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) {
    reference = await json(`${base}/git/tags/${object.sha}`);
    object = reference.object;
  }
  if (object?.type !== 'commit' || object.sha !== delivery.sourceCommit) {
    throw new Error('Release tag no longer matches the built source commit.');
  }
  const existing = new Map();
  for (let page = 1; page <= 10; page++) {
    const assets = await json(`${base}/releases/${release.id}/assets?per_page=100&page=${page}`);
    for (const asset of assets) {
      existing.set(asset.name, asset);
    }
    if (assets.length < 100) {
      break;
    }
    if (page === 10) {
      throw new Error('Release asset inventory exceeds the supported limit.');
    }
  }
  for (const asset of delivery.assets) {
    const current = existing.get(asset.name);
    if (
      current &&
      (current.state !== 'uploaded' ||
        current.size !== asset.size ||
        current.digest !== `sha256:${asset.sha256}`)
    ) {
      throw new Error(`Published asset conflicts with verified delivery: ${asset.name}`);
    }
  }
  const uploaded = [];
  for (const asset of delivery.assets) {
    if (!existing.has(asset.name)) {
      const url = new URL(release.upload_url.replace(/\{.*$/, ''));
      if (url.origin !== 'https://uploads.github.com') {
        throw new Error('Unexpected GitHub Release upload origin.');
      }
      url.searchParams.set('name', asset.name);
      const result = await json(url.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(asset.size) },
        body: createReadStream(asset.path),
        duplex: 'half',
      });
      if (
        result.name !== asset.name ||
        result.state !== 'uploaded' ||
        result.size !== asset.size ||
        result.digest !== `sha256:${asset.sha256}`
      ) {
        throw new Error(`Uploaded asset digest was not confirmed: ${asset.name}`);
      }
      uploaded.push(asset.name);
    }
  }
  return {
    releaseUrl: release.html_url,
    productBuildId: delivery.productBuildId,
    uploaded,
    retained: delivery.assets.length - uploaded.length,
  };
}
