/**
 * @author Codex
 * @description Removes only Server compiler outputs so retired module entrypoints cannot survive a rebuild.
 */
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(serverRoot, 'dist');
if (dirname(output) !== serverRoot) {
  throw new Error('Server build output must be a direct child of the Server package.');
}
if (existsSync(output)) {
  const resolved = relative(serverRoot, realpathSync(output));
  if (resolved === '..' || resolved.startsWith(`..${sep}`) || resolved !== 'dist') {
    throw new Error('Server build output resolves outside the intended output directory.');
  }
  rmSync(output, { recursive: true });
}
rmSync(resolve(serverRoot, 'node_modules/.tmp/server-build.tsbuildinfo'), { force: true });
