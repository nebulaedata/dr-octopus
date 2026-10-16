/**
 * @author Codex
 * @description Resolves only packaged UI assets beneath their real resource root.
 */
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Keeps executable resources on the real filesystem while bundled UI remains inside app.asar.
 */
export function executionResourceRoot(packaged: boolean, resources: string, appPath: string): string {
  return packaged ? resolve(resources, 'executor') : resolve(appPath, 'dist');
}

/**
 * Rejects foreign origins, encoded traversal and symlink escapes before serving a file.
 * @returns An absolute regular-file path, or null for requests outside the asset contract.
 */
export async function resolveUiAsset(root: string, requestUrl: string): Promise<string | null> {
  const url = new URL(requestUrl);
  if (
    url.protocol !== 'app:' ||
    url.hostname !== 'ui' ||
    url.port ||
    url.username ||
    url.password ||
    url.search
  ) {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) {
    return null;
  }
  const rootPath = await realpath(root);
  const requested = resolve(rootPath, '.' + (pathname === '/' ? '/index.html' : pathname));
  try {
    const candidate = await realpath(requested);
    const inside = relative(rootPath, candidate);
    if (inside.startsWith('..') || isAbsolute(inside) || !(await stat(candidate)).isFile()) {
      return null;
    }
    return candidate;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return null;
    }
    throw error;
  }
}
