/**
 * @author Codex
 * @description Verifies and atomically extracts the packaged workspace into a writable, isolated runtime directory.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { extract } from 'tar';
import { insidePath, portablePath, readReleaseLayout } from './config.js';
import { distribution, runtimeDirectory } from './location.js';
import type { Distribution } from './location.js';

/**
 * Requires the caller to hold the runtime installation lock before extracting or modifying the destination.
 */
export async function prepareRuntime(
  context: Distribution = distribution(),
  root = runtimeDirectory(context)
): Promise<void> {
  if (!context.packaged) {
    return;
  }
  const marker = join(root, '.payload-sha256');
  const existing = await readFile(marker, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return undefined;
  });
  if (existing === context.layout.sha256) {
    return;
  }
  if (existing !== undefined) {
    throw new Error('Runtime payload identity differs from the installed npm package.');
  }
  const archive = insidePath(context.root, context.layout.archive!);
  const digest = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  if (digest !== context.layout.sha256) {
    throw new Error('Runtime archive checksum mismatch. Reinstall the npm package.');
  }
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(`${root}.extract-`);
  try {
    await extract({
      file: archive,
      cwd: staging,
      strict: true,
      preservePaths: false,
      filter(path, entry) {
        portablePath(path.replace(/\/$/, ''));
        if (!('type' in entry) || (entry.type !== 'File' && entry.type !== 'Directory')) {
          throw new Error(`Unsupported runtime archive entry: ${path}`);
        }
        return true;
      },
    });
    const actual = readReleaseLayout(join(staging, 'release-layout.json'));
    const expected = { ...context.layout };
    delete expected.archive;
    delete expected.sha256;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('Runtime layout differs from the npm package index.');
    }
    await writeFile(join(staging, '.payload-sha256'), digest, { mode: 0o600 });
    await rename(staging, root);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
