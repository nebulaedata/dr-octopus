/**
 * @author Codex
 * @description Validates current-user private stdio credentials against actual Windows native file protection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { readStdioConfig } from '../../src/bridge/stdio-config.ts';

test('stdio adopts only private loopback exported grants and never commands or browser credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-stdio-config-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const config = {
    protocolVersion: '2025-11-25',
    clientId: randomUUID(),
    scope: 'device',
    mcpServers: {
      'octopus-executor': {
        url: 'http://127.0.0.1:18888/mcp',
        headers: { Authorization: `Bearer ${'a'.repeat(64)}` },
      },
    },
  };
  /**
   * Creates each credential once with the production SID-private native writer.
   */
  async function store(value) {
    const path = join(root, `${randomUUID()}.json`);
    assert.equal((await native.writePrivateConfig(path, JSON.stringify(value))).ok, true);
    return ['--mcp-stdio', '--config', path];
  }
  try {
    assert.deepEqual(await readStdioConfig(native, await store(config)), {
      endpoint: config.mcpServers['octopus-executor'].url,
      authorization: config.mcpServers['octopus-executor'].headers.Authorization,
    });
    for (const url of [
      'https://example.com/mcp',
      'http://localhost:18888/mcp',
      'http://127.0.0.1:18888/browser-bridge',
      'http://127.0.0.1:99999/mcp',
      'http://127.0.0.1:18888/mcp?x=1',
    ]) {
      const invalid = structuredClone(config);
      invalid.mcpServers['octopus-executor'].url = url;
      await assert.rejects(readStdioConfig(native, await store(invalid)));
    }
    await assert.rejects(readStdioConfig(native, await store({ ...config, command: 'node' })));
    const { scope: _scope, ...oldConfig } = config;
    assert.equal(_scope, 'device');
    await assert.rejects(readStdioConfig(native, await store({ ...oldConfig, workspaceId: randomUUID() })));
    const path = join(root, 'open.json');
    await writeFile(path, JSON.stringify(config));
    await assert.rejects(
      readStdioConfig(native, ['--mcp-stdio', '--config', path]),
      /STDIO_CONFIG_PROTECTION/
    );
    await assert.rejects(
      readStdioConfig(native, ['--mcp-stdio', '--config', 'relative.json']),
      /STDIO_CONFIG_ARGUMENTS/
    );
    const launcher = join(root, 'native', 'mcp-launcher.exe');
    const stdioPath = join(root, 'stdio.json');
    const stdio = {
      protocolVersion: config.protocolVersion,
      clientId: config.clientId,
      scope: 'device',
      runtime: config.mcpServers['octopus-executor'],
      mcpServers: { 'octopus-executor': { command: launcher, args: ['--mcp-stdio', '--config', stdioPath] } },
    };
    assert.equal((await native.writePrivateConfig(stdioPath, JSON.stringify(stdio))).ok, true);
    assert.equal(
      (await readStdioConfig(native, ['--mcp-stdio', '--config', stdioPath], launcher)).endpoint,
      config.mcpServers['octopus-executor'].url
    );
    await assert.rejects(
      readStdioConfig(native, ['--mcp-stdio', '--config', stdioPath], join(root, 'foreign.exe')),
      /STDIO_CONFIG_LAUNCHER/
    );
    const copied = join(root, 'copied-stdio.json');
    assert.equal((await native.writePrivateConfig(copied, JSON.stringify(stdio))).ok, true);
    await assert.rejects(
      readStdioConfig(native, ['--mcp-stdio', '--config', copied], launcher),
      /STDIO_CONFIG_LAUNCHER/
    );
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-stdio-config-')));
    await rm(root, { recursive: true, force: true });
  }
});
