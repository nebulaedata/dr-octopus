/**
 * @author Codex
 * @description Copies the original workspace installation graph and configuration-selected build artifacts.
 */
import { cp, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';

/**
 * Checks containment using path segments, including paths on other Windows drives.
 */
export function isInside(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Rejects declared commands that selected artifacts would leave absent from the installed workspace.
 */
async function assertPackageBins(destination, manifest) {
  const bins = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
  for (const bin of bins) {
    const path = resolve(destination, bin);
    const info = isInside(destination, path)
      ? await stat(path).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        })
      : null;
    if (!info?.isFile()) {
      throw new Error(`Missing release bin for ${manifest.name}: ${bin}. Include it in release artifacts.`);
    }
  }
}

/**
 * Copies an unchanged install graph; pnpm owns discovery and dependency resolution.
 * @param {string} root Source workspace root.
 * @param {string} target Empty staging directory outside all package dist directories.
 * @param {{path: string}[]} projects Workspace projects reported by pnpm list.
 * @param {Record<string, string[]>} artifacts Package-relative artifact directories selected by package name.
 */
export async function copyWorkspaceRelease(root, target, projects, artifacts) {
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    await cp(join(root, file), join(target, file));
  }
  for (const project of projects) {
    if (!isInside(root, project.path)) {
      throw new Error(`Workspace package is outside the repository: ${project.path}`);
    }
    if (resolve(project.path) === resolve(root)) {
      continue;
    }
    const destination = join(target, relative(root, project.path));
    await mkdir(destination, { recursive: true });
    await cp(join(project.path, 'package.json'), join(destination, 'package.json'));
    const manifest = JSON.parse(await readFile(join(project.path, 'package.json'), 'utf8'));
    for (const artifact of artifacts[manifest.name] ?? artifacts['*'] ?? []) {
      const dist = resolve(project.path, artifact);
      if (!isInside(project.path, dist) || dist === resolve(project.path)) {
        throw new Error(`Invalid artifact path: ${artifact}`);
      }
      const info = await stat(dist).catch((error) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        return null;
      });
      if (info) {
        if (!info.isDirectory()) {
          throw new Error(`Package artifact must be a directory: ${dist}`);
        }
        if (!isInside(await realpath(project.path), await realpath(dist))) {
          throw new Error(`Artifact escapes its package: ${artifact}`);
        }
        await cp(dist, join(destination, artifact), { recursive: true, dereference: false });
      }
    }
    await assertPackageBins(destination, manifest);
  }
  const config = parse(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  for (const patch of Object.values(config.patchedDependencies ?? {})) {
    const path = typeof patch === 'string' ? patch : patch.path;
    const source = resolve(root, path);
    if (!isInside(root, source) || !isInside(await realpath(root), await realpath(source))) {
      throw new Error(`Patch is outside the workspace: ${path}`);
    }
    const destination = join(target, relative(root, source));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}
