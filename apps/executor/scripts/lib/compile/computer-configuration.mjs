/**
 * @author Codex
 * @description Owns fixed private Python configuration bytes and checks the resource pin against the compiled desktop contract.
 */
import { writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applicationApi } from './application-api.mjs';
import { computerManifestSchema } from '../resources/computer-manifest.mjs';

// Standard comtypes first-import output, produced by the pinned wheel itself.
export const computerInitializationFile = Object.freeze({
  path: 'Lib/site-packages/comtypes/gen/__init__.py',
  size: 56,
  sha256: '0d474e302634b834072be47bae442dd92b5919dba7870f13e8c8f91272dd8f68',
});

/**
 * Runs standard upstream initialization before inventory creation; never writes or replaces third-party source itself.
 * The generated package marker is pinned separately from the wheel, and runtime typelib wrappers remain in memory.
 */
export async function initializeComputerConfiguration(resources) {
  await promisify(execFile)(join(resources, 'python.exe'), ['-B', '-I', '-c', 'import comtypes.client'], {
    cwd: resources,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 16384,
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    },
  });
  const bytes = await readFile(join(resources, computerInitializationFile.path));
  if (
    bytes.length !== computerInitializationFile.size ||
    createHash('sha256').update(bytes).digest('hex') !== computerInitializationFile.sha256
  ) {
    throw new Error('COMPUTER_INITIALIZATION_HASH_MISMATCH');
  }
}

/**
 * Loads the authoritative asset pin and refuses a runtime/schema version mismatch before publishing resources.
 */
export async function readComputerPin(root) {
  const pin = computerManifestSchema.parse(
    JSON.parse(await readFile(join(root, 'vendor/windows-mcp.json'), 'utf8'))
  );
  if (pin.windowsMcp.version !== applicationApi.windowsMcpVersion) {
    throw new Error('COMPUTER_CONTRACT_VERSION_MISMATCH');
  }
  return pin;
}

/**
 * Produces the same deterministic source bytes for resource assembly and trusted inventory generation.
 */
export async function computerConfigurationFiles(root, pin) {
  return {
    'python314._pth': Buffer.from('python314.zip\r\n.\r\nLib/site-packages\r\nimport site\r\n'),
    '.executor-asset.json': Buffer.from(JSON.stringify(pin)),
    'executor.toml': Buffer.from(
      '# Fixed Executor configuration. Tool whitelist is supplied by the trusted owner.\n'
    ),
    'sitecustomize.py': await readFile(join(root, 'vendor/computer-sitecustomize.py')),
  };
}

/**
 * Publishes only owned configuration files; upstream sources remain the verified official wheel bytes.
 */
export async function publishComputerConfiguration(root, resources) {
  const pin = await readComputerPin(root);
  await stat(
    join(resources, 'Lib/site-packages', 'windows_mcp-' + pin.windowsMcp.version + '.dist-info/METADATA')
  );
  try {
    await stat(join(resources, 'product'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    for (const [path, bytes] of Object.entries(await computerConfigurationFiles(root, pin))) {
      await writeFile(join(resources, path), bytes);
    }
    return;
  }
  throw new Error('COMPUTER_LEGACY_RESOURCE_PRESENT: assemble a fresh upstream environment');
}
