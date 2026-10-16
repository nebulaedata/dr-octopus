/**
 * @author Codex
 * @description Prepares verified Node development headers explicitly; platform selection is separate from archive acquisition.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { executorTarget } from '../lib/platform.mjs';
const { values } = parseArgs({ options: { 'cache-dir': { type: 'string' } }, allowPositionals: false });
if (!values['cache-dir']) {
  throw new Error('Provide --cache-dir pointing to a new directory.');
}
const target = executorTarget();
const cache = resolve(values['cache-dir']);
await mkdir(cache);
/**
 * Downloads only during this explicit preparation command with a finite network deadline.
 */
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: 'error' });
  if (!response.ok) {
    throw new Error('Node header download failed: ' + response.status);
  }
  return Buffer.from(await response.arrayBuffer());
}
const base = 'https://nodejs.org/dist/v24.20.0/';
const sums = (await download(base + 'SHASUMS256.txt')).toString('utf8');
const checksum = /^([a-f0-9]{64})\s+node-v24\.20\.0-headers\.tar\.gz\r?$/m.exec(sums)?.[1];
if (!checksum) {
  throw new Error('Exact header checksum unavailable.');
}
const archive = await download(base + 'node-v24.20.0-headers.tar.gz');
if (createHash('sha256').update(archive).digest('hex') !== checksum) {
  throw new Error('Header archive digest mismatch.');
}
const archivePath = join(cache, 'headers.tar.gz');
await writeFile(archivePath, archive, { flag: 'wx' });
await promisify(execFile)(target.tar, ['-xzf', archivePath, '-C', cache], {
  windowsHide: true,
  timeout: 120000,
});
const headers = join(cache, 'node-v24.20.0');
await mkdir(join(headers, 'x64'));
const library = await download(base + 'win-x64/node.lib');
if (
  createHash('sha256').update(library).digest('hex') !==
  '63ec831bbf164d1b23197d6fac1944dfb146534e332889ca0755d250e8dedff9'
) {
  throw new Error('Fixed Node import library digest mismatch.');
}
await writeFile(join(headers, 'x64/node.lib'), library, { flag: 'wx' });
await readFile(join(headers, 'include/node/node.h'));
process.stdout.write(headers + '\n');
