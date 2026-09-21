/**
 * @author Codex
 * @description Assembles a standalone npm bootstrap and a checksummed workspace archive from discovered packages.
 */
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { create } from 'tar';
import { copyWorkspaceRelease } from './workspace-release.mjs';
import { createPublicationManifest } from './release-manifest.mjs';
import { createReleaseLayout, insidePath, resourcePath } from '../src/distribution/config.ts';

/**
 * Rejects links in the payload so no development-machine dependency can escape into the delivered archive.
 */
async function assertPortableTree(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error(`Unsupported release resource: ${path}`);
    }
    if (entry.isDirectory()) await assertPortableTree(path);
  }
}

/**
 * Copies declared artifacts and original dependency metadata, then generates only the publication surface.
 * @param {string} root Source workspace discovered from release.config.json.
 * @param {string} target Empty npm package staging directory.
 * @param {import('../src/distribution/config.ts').WorkspaceProject[]} projects pnpm-discovered packages.
 * @param {import('../src/distribution/config.ts').ReleaseConfig} config Validated external configuration.
 */
export async function assembleRelease(root, target, projects, config) {
  const readmes = { 'README.md': config.readme, ...config.readmeTranslations };
  const legalFiles = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
  for (const source of Object.values(readmes)) {
    if (!(await lstat(insidePath(root, source))).isFile()) {
      throw new Error(`Release README must be a regular file: ${source}`);
    }
  }
  const layout = createReleaseLayout(root, projects, config);
  for (const name of Object.keys(config.artifacts)) {
    if (name !== '*' && !projects.some((project) => project.name === name)) {
      throw new Error(`Unknown artifact package: ${name}`);
    }
  }
  const workspace = await mkdtemp(join(target, '.workspace-'));
  try {
    await copyWorkspaceRelease(root, workspace, projects, config.artifacts);
    for (const file of legalFiles) {
      await cp(join(root, file), join(workspace, file), { recursive: true, dereference: false });
    }
    for (const [role, path] of Object.entries(layout.paths)) {
      const info = await lstat(insidePath(workspace, path));
      if (role.endsWith('Entry') ? !info.isFile() : !info.isDirectory()) {
        throw new Error(`Invalid configured runtime resource: ${role}`);
      }
    }
    await lstat(join(workspace, layout.paths.webClient, 'index.html'));
    await writeFile(join(workspace, 'release-layout.json'), JSON.stringify(layout, null, 2) + '\n');
    await assertPortableTree(workspace);
    for (const file of legalFiles) {
      await cp(join(workspace, file), join(target, file), { recursive: true, dereference: false });
    }
    const bootstrap = insidePath(target, config.bootstrap.destination);
    await mkdir(dirname(bootstrap), { recursive: true });
    await cp(insidePath(workspace, resourcePath(root, projects, config.bootstrap)), bootstrap);
    const archive = insidePath(target, config.archive);
    await mkdir(dirname(archive), { recursive: true });
    await create(
      { cwd: workspace, file: archive, gzip: true, portable: true, noMtime: true },
      (await readdir(workspace)).sort()
    );
    const sha256 = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    await writeFile(
      join(target, 'release-layout.json'),
      JSON.stringify({ ...layout, archive: config.archive, sha256 }, null, 2) + '\n'
    );
    for (const [destination, source] of Object.entries(readmes)) {
      await cp(insidePath(root, source), insidePath(target, destination));
    }
    await writeFile(
      join(target, 'package.json'),
      JSON.stringify(createPublicationManifest(config), null, 2) + '\n'
    );
    return { ...layout, archive: config.archive, sha256 };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
