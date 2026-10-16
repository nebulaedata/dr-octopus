/**
 * @author Codex
 * @description Extracts and indexes already verified ZIP archives with bounded memory, exact paths and no shell or platform-specific extractor.
 */
import { unzipSync } from 'fflate';
import { readFile, stat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
const archiveLimit = 256 * 1024 * 1024;
const expandedLimit = 512 * 1024 * 1024;
/**
 * Rejects paths that escape staging or alias Windows names, even when checks run on another platform.
 */
function safePath(name) {
  const parts = name.replace(/\/$/, '').split('/');
  if (
    !name ||
    /[\\:]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
  ) {
    throw new Error('Archive path rejected: ' + name);
  }
  return parts.join('/');
}
/**
 * Reads bounded entries; filtering sees every central-directory entry before decompression, including duplicates.
 */
export async function readZip(archive) {
  if ((await stat(archive)).size > archiveLimit) {
    throw new Error('Archive size limit');
  }
  const seen = new Set();
  const directories = [];
  let total = 0;
  const files = unzipSync(await readFile(archive), {
    filter(entry) {
      const normalized = safePath(entry.name);
      if (entry.name.endsWith('/')) {
        directories.push(normalized);
        return false;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        throw new Error('Archive collision rejected');
      }
      seen.add(key);
      total += entry.originalSize;
      if (seen.size > 20000 || entry.originalSize > archiveLimit || total > expandedLimit) {
        throw new Error('Expanded archive size limit');
      }
      return true;
    },
  });
  return { files, directories };
}
/**
 * Maps wheel purelib/platlib payloads using the same rules for extraction and inventory.
 */
function wheelPath(name, wheel) {
  if (!wheel) {
    return name;
  }
  const match = /^[^/]+\.data\/(purelib|platlib)\/(.+)$/.exec(name);
  if (match) {
    return match[2];
  }
  return /^[^/]+\.data\//.test(name) ? null : name;
}
/**
 * Publishes into a newly created owned root; existing files, symlink parents and case aliases are rejected.
 */
async function extractInto(archive, destination, wheel = false, seen = new Set()) {
  const data = await readZip(archive);
  const root = await realpath(destination);
  for (const directory of data.directories) {
    const name = wheelPath(directory, wheel);
    if (name) {
      await mkdir(join(root, safePath(name)), { recursive: true });
    }
  }
  for (const [original, bytes] of Object.entries(data.files)) {
    const name = wheelPath(original, wheel);
    if (!name) {
      continue;
    }
    const target = join(root, safePath(name));
    const key = target.toLowerCase();
    if (seen.has(key)) {
      throw new Error('Archive collision rejected');
    }
    seen.add(key);
    await mkdir(dirname(target), { recursive: true });
    const actual = await realpath(dirname(target));
    const expected = resolve(dirname(target));
    if (
      process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected
    ) {
      throw new Error('Archive destination alias rejected');
    }
    await writeFile(target, bytes, { flag: 'wx' });
  }
}
/**
 * Extracts a verified ZIP into a new directory without requiring PowerShell.
 */
export async function extractZip(archive, destination) {
  await mkdir(destination);
  await extractInto(archive, destination);
}
/**
 * Extracts Python and wheels into fresh private staging; never overwrites a prior assembled runtime.
 */
export async function extractComputer(archives, destination) {
  await mkdir(destination);
  const seen = new Set();
  await extractInto(archives.python, destination, false, seen);
  const library = join(destination, 'Lib/site-packages');
  await mkdir(library, { recursive: true });
  for (const archive of archives.wheels) {
    await extractInto(archive, library, true, seen);
  }
}
/**
 * Computes trusted inventory directly from original archive bytes; generated product files are handled by their owner.
 */
export async function indexComputer(archives) {
  const entries = [];
  const seen = new Set();
  for (const [archive, prefix, wheel] of [
    [archives.python, 'resources/computer/', false],
    ...archives.wheels.map((file) => [file, 'resources/computer/Lib/site-packages/', true]),
  ]) {
    const { files } = await readZip(archive);
    for (const [original, bytes] of Object.entries(files)) {
      const name = wheelPath(original, wheel);
      if (!name) {
        continue;
      }
      const file = prefix + safePath(name);
      if (seen.has(file.toLowerCase())) {
        throw new Error('Archive collision rejected');
      }
      seen.add(file.toLowerCase());
      if (file === 'resources/computer/python314._pth') {
        continue;
      }
      entries.push({
        path: file,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return entries;
}
/**
 * Indexes the selected Node/npm distribution payload and notices, without executing any archive contents.
 */
export async function indexNode(archive) {
  const { files } = await readZip(archive);
  const entries = [];
  const prefix = 'node-v24.20.0-win-x64/';
  const selected = new Set([
    'node.exe',
    'LICENSE',
    'CHANGELOG.md',
    'npm',
    'npm.cmd',
    'npm.ps1',
    'npx',
    'npx.cmd',
    'npx.ps1',
  ]);
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.startsWith(prefix)) {
      throw new Error('Invalid Node archive root');
    }
    const file = name.slice(prefix.length);
    if (!selected.has(file) && !file.startsWith('node_modules/npm/')) {
      continue;
    }
    entries.push({
      path: file,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return entries;
}
