/**
 * @author Codex
 * @description Verifies private stdio configuration identity across installation moves, restarts and changed endpoints without overwriting retained files.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { deviceConnectionKey } from '../../src/contracts/device-identity.ts';
import test from 'node:test';
import { build } from 'esbuild';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { readStdioConfig } from '../../src/bridge/stdio-config.ts';

/**
 * Replaces only Electron's OS encryption service; all private file I/O and configuration validation remain real.
 */
async function loadConfigurations() {
  const built = await build({
    entryPoints: [fileURLToPath(new URL('../../src/main/client-configurations.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
  });
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  const safeStorage = {
    /**
     * Emulates availability without accessing the user's actual OS key store.
     */
    async isAsyncEncryptionAvailable() {
      return true;
    },
    /**
     * Keeps fixture credential bytes deterministic inside the temporary private data directory.
     */
    async encryptStringAsync(value) {
      return Buffer.from(value);
    },
    /**
     * Returns the same validated envelope shape as Electron's asynchronous decryption API.
     */
    async decryptStringAsync(value) {
      return { result: value.toString('utf8'), shouldReEncrypt: false };
    },
  };
  /**
   * Uses real dependencies except for the explicit Electron encryption test substitute.
   */
  const load = (name) => (name === 'electron' ? { safeStorage } : require(name));
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(load, module, module.exports);
  return module.exports.ClientConfigurations;
}

test('stdio configuration survives installation moves and endpoint changes while retaining private immutable files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-config-identity-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  try {
    const resources = [join(root, 'old installation'), join(root, 'new installation')];
    for (const directory of resources) {
      for (const entry of [
        'native/mcp-launcher.exe',
        'native/stdio-exit.node',
        'bridge/mcp-stdio.cjs',
        'resources/node/node.exe',
      ]) {
        const path = join(directory, entry);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, 'fixture');
      }
    }
    const data = join(root, 'data');
    await mkdir(data);
    const ClientConfigurations = await loadConfigurations();
    const clientId = randomUUID();
    const input = { clientId, transport: 'stdio' };
    const device = { deviceId: randomUUID(), deviceName: '办公电脑' };
    const connectionKey = deviceConnectionKey(device);
    const snapshot = {
      device,
      clients: [{ clientId, revoked: false, permissions: ['files.read', 'computer.observe'] }],
      endpoint: 'http://127.0.0.1:19876/mcp',
      remoteEndpoint: null,
    };
    const first = new ClientConfigurations(native, data, resources[0]);
    const credential = 'a'.repeat(64);
    await first.store(clientId, credential);
    for (const transport of ['http', 'remote-http']) {
      const configured = { ...snapshot, remoteEndpoint: 'http://192.168.1.10:19876/mcp' };
      const exported = JSON.parse(await first.configuration({ clientId, transport }, configured, false));
      assert.deepEqual(Object.keys(exported.mcpServers), [connectionKey]);
      assert.equal(exported.mcpServers[connectionKey].headers.Authorization, 'Bearer ' + credential);
      const renamed = { ...configured, device: { ...device, deviceName: 'renamed computer' } };
      assert.deepEqual(
        JSON.parse(await first.configuration({ clientId, transport }, renamed, false)),
        exported
      );
      const guide = await first.agentGuide({ clientId, transport }, configured);
      const blocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
      assert.equal(blocks[0].deviceId, device.deviceId);
      assert.equal(blocks[0].connectionKey, connectionKey);
      assert.deepEqual(blocks[0].permissions, snapshot.clients[0].permissions);
      assert.deepEqual(blocks[1], exported);
      assert.ok(guide.includes('runtime_status'));
      assert.ok(guide.includes('file_upload_prepare'));
      assert.ok(guide.includes('没有此能力不要调用'));
      assert.equal(guide.includes('executor-client'), false);
      assert.ok(guide.includes(transport === 'http' ? '本机 HTTP' : '内网 / VPN HTTP'));
      const hostile = await first.agentGuide(
        { clientId, transport },
        {
          ...configured,
          device: { ...device, deviceName: '```办公室"电脑' },
        }
      );
      assert.equal([...hostile.matchAll(/^```json$/gm)].length, 2);
      const identity = JSON.parse([...hostile.matchAll(/```json\n([\s\S]*?)\n```/g)][0][1]);
      assert.equal(identity.deviceName, '```办公室"电脑');
      await assert.rejects(
        first.agentGuide(
          { clientId, transport },
          {
            ...configured,
            clients: [{ ...snapshot.clients[0], revoked: true }],
          }
        ),
        /GRANT_UNAVAILABLE/
      );
    }
    await assert.rejects(
      first.agentGuide({ clientId, transport: 'remote-http' }, snapshot),
      /LISTENER_UNAVAILABLE/
    );
    const stdioGuide = await first.agentGuide(input, snapshot);
    assert.ok(stdioGuide.includes('本机 stdio'));
    assert.equal(stdioGuide.includes(credential), false);
    const original = JSON.parse(await first.configuration(input, snapshot, false)).mcpServers[connectionKey];
    const originalBytes = await readFile(original.args[2]);
    assert.equal((await native.inspect(original.args[2])).privateAcl, true);
    assert.deepEqual(await readStdioConfig(native, original.args, original.command), {
      endpoint: snapshot.endpoint,
      authorization: 'Bearer ' + credential,
    });
    const restarted = new ClientConfigurations(native, data, resources[0]);
    assert.deepEqual(
      JSON.parse(await restarted.configuration(input, snapshot, false)).mcpServers[connectionKey],
      original
    );
    const moved = new ClientConfigurations(native, data, resources[1]);
    const preview = await moved.configuration(input, snapshot, true);
    assert.equal(preview.includes(credential), false);
    const replacement = JSON.parse(await moved.configuration(input, snapshot, false)).mcpServers[
      connectionKey
    ];
    assert.deepEqual(JSON.parse(preview).mcpServers[connectionKey], replacement);
    assert.equal(replacement.command, join(resources[1], 'native/mcp-launcher.exe'));
    assert.notEqual(replacement.args[2], original.args[2]);
    assert.equal((await native.inspect(replacement.args[2])).privateAcl, true);
    assert.deepEqual(await readStdioConfig(native, replacement.args, replacement.command), {
      endpoint: snapshot.endpoint,
      authorization: 'Bearer ' + credential,
    });
    assert.deepEqual(await readFile(original.args[2]), originalBytes);
    assert.equal(
      await first.configuration(input, snapshot, false),
      JSON.stringify({ mcpServers: { [connectionKey]: original } }, null, 2) + '\n'
    );
    const changedEndpoint = { ...snapshot, endpoint: 'http://127.0.0.1:80/mcp' };
    const changed = JSON.parse(await moved.configuration(input, changedEndpoint, false)).mcpServers[
      connectionKey
    ];
    assert.notEqual(changed.args[2], replacement.args[2]);
    assert.equal(
      (await readStdioConfig(native, changed.args, changed.command)).endpoint,
      changedEndpoint.endpoint
    );
    await writeFile(replacement.args[2], '{}\n');
    await assert.rejects(moved.configuration(input, snapshot, false), /STDIO_CONFIG_CHANGED/);
    assert.equal(await readFile(replacement.args[2], 'utf8'), '{}\n');
    await assert.rejects(
      moved.configuration(input, { ...snapshot, clients: [{ clientId, revoked: true }] }, false),
      /GRANT_UNAVAILABLE/
    );
    await assert.rejects(
      moved.configuration({ ...input, clientId: randomUUID() }, snapshot, false),
      /GRANT_UNAVAILABLE/
    );
    const relocatedData = join(root, 'relocated project');
    await rename(data, relocatedData);
    const relocated = new ClientConfigurations(native, relocatedData, resources[1]);
    const relocatedServer = JSON.parse(await relocated.configuration(input, snapshot, false)).mcpServers[
      connectionKey
    ];
    assert.ok(relocatedServer.args[2].startsWith(relocatedData));
    assert.notEqual(relocatedServer.args[2].split(/[\\/]/).at(-1), replacement.args[2].split(/[\\/]/).at(-1));
    assert.equal(
      (await readStdioConfig(native, relocatedServer.args, relocatedServer.command)).authorization,
      'Bearer ' + credential
    );
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-config-identity-')));
    await rm(root, { recursive: true, force: true });
  }
});
