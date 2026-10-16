/**
 * @author Codex
 * @description Compiles application-owned contracts to JavaScript for engineering consumers without executing TypeScript or duplicating product rules.
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
/**
 * Publishes only compiler output in the build directory; Node imports the resulting ES module artifact.
 */
async function compileApplicationApi() {
  const output = join(root, 'build/tooling/application-api.mjs');
  const exports = [
    "export { developmentRestartExitCode } from './src/contracts/runtime.ts';",
    "export { NativeFileCommit } from './src/runtime/basic/native-file-commit.ts';",
    "export { NodeResources, nodeInventorySchema } from './src/runtime/basic/node-resources.ts';",
    "export { executorProduct } from './src/contracts/product.ts';",
    "export { networkAddressSchema } from './src/contracts/connection-settings.ts';",
    "export { backendSchemas, computerSchemas } from './src/runtime/computer/computer-inputs.ts';",
    "export { readInputSchema, writeInputSchema, editInputSchema, shellInputSchema } from './src/runtime/basic/basic-inputs.ts';",
    "export { lsInputSchema, findInputSchema, grepInputSchema } from './src/runtime/basic/search-inputs.ts';",
    "export { browserSchemas } from './src/runtime/browser/browser-tools.ts';",
    "export { taskStartSchema, taskStatusSchema, taskIdSchema } from './src/runtime/mcp/control-inputs.ts';",
  ];
  const result = await build({
    stdin: { contents: exports.join('\n'), resolveDir: root, sourcefile: 'application-api.js', loader: 'js' },
    outfile: output,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
  });
  const bytes = result.outputFiles[0].contents;
  await mkdir(join(root, 'build/tooling'), { recursive: true });
  let same = false;
  try {
    same = Buffer.from(bytes).equals(await readFile(output));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (!same) {
    const staging = output + '.' + randomUUID();
    await writeFile(staging, bytes, { flag: 'wx' });
    await rename(staging, output);
  }
  return import(pathToFileURL(output).href);
}
export const applicationApi = await compileApplicationApi();
