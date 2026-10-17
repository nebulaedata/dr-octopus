/**
 * @author Codex
 * @description Ensures private configuration never modifies official upstream source and rejects the retired bespoke backend.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readZip } from '../scripts/lib/resources/archives.mjs';
import {
  publishComputerConfiguration,
  readComputerPin,
} from '../scripts/lib/compile/computer-configuration.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

test('private configuration leaves official Windows-MCP bytes unchanged across repeated publication', async () => {
  const data = await mkdtemp(join(tmpdir(), 'octopus-upstream-configuration-'));
  try {
    const archive = await readZip(join(root, 'build/vendor/computer/windows_mcp-0.8.8-py3-none-any.whl'));
    const official = Buffer.from(archive.files['windows_mcp/desktop/service.py']);
    const target = join(data, 'Lib/site-packages/windows_mcp/desktop/service.py');
    const metadata = join(data, 'Lib/site-packages/windows_mcp-0.8.8.dist-info/METADATA');
    await mkdir(dirname(target), { recursive: true });
    await mkdir(dirname(metadata), { recursive: true });
    await writeFile(target, official);
    await writeFile(metadata, archive.files['windows_mcp-0.8.8.dist-info/METADATA']);
    await publishComputerConfiguration(root, data);
    await publishComputerConfiguration(root, data);
    assert.deepEqual(await readFile(target), official);
    assert.equal(
      createHash('sha256')
        .update(await readFile(target))
        .digest('hex'),
      'c116adc0d221c993a89596a14f0ac66bf924e250672cb2691a8914b0e788231e'
    );
    assert.deepEqual(
      await readFile(join(data, 'sitecustomize.py')),
      await readFile(join(root, 'vendor/computer-sitecustomize.py'))
    );
    await mkdir(join(data, 'product'));
    await assert.rejects(publishComputerConfiguration(root, data), /COMPUTER_LEGACY_RESOURCE_PRESENT/);
  } finally {
    assert.ok(data.startsWith(join(tmpdir(), 'octopus-upstream-configuration-')));
    await rm(data, { recursive: true, force: true });
  }
});

test('a changed upstream resource version is rejected against the compiled contract before publication', async () => {
  const data = await mkdtemp(join(tmpdir(), 'octopus-computer-version-'));
  try {
    const pin = JSON.parse(await readFile(join(root, 'vendor/windows-mcp.json'), 'utf8'));
    pin.windowsMcp.version = '0.8.9';
    await mkdir(join(data, 'vendor'));
    await writeFile(join(data, 'vendor/windows-mcp.json'), JSON.stringify(pin));
    await assert.rejects(readComputerPin(data), /COMPUTER_CONTRACT_VERSION_MISMATCH/);
  } finally {
    assert.ok(data.startsWith(join(tmpdir(), 'octopus-computer-version-')));
    await rm(data, { recursive: true, force: true });
  }
});
