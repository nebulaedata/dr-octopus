/**
 * @author Codex
 * @description Verifies the portable acceptance companion against real authenticated MCP and native reads, including failure evidence, private Node execution and report preservation.
 */
import assert from 'node:assert/strict';
import { policyToolNameSchema } from '../../src/contracts/tool-policy.ts';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { prepareAcceptanceKit } from '../../scripts/package/prepare-acceptance-kit.mjs';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { TaskAuthority } from '../../src/runtime/mcp/task-authority.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';
import { networkAddressSchema } from '../../src/contracts/connection-settings.ts';

const project = join(import.meta.dirname, '../..');
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const content = '专用网络验收\r\nDr.Octopus Executor v0.0.1\r\n';
const digest = createHash('sha256').update(content).digest('hex');

/**
 * Runs only the prepared companion, with no usable system runtime PATH and injected Node settings that the launcher must clear.
 */
async function execute(kit, product, config, report, expected = digest) {
  const child = spawn(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(kit, 'network-probe.ps1'),
      '-ProductDirectory',
      product,
      '-ConfigPath',
      config,
      '-ReportPath',
      report,
      '-FixturePath',
      join(product, '..', 'workspace', 'network-evidence.txt'),
      '-ExpectedSha256',
      expected,
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        PATH: join(process.env.SystemRoot, 'System32'),
        NODE_OPTIONS: '--require=nonexistent-node-injection',
        NODE_PATH: 'nonexistent-node-path',
        PATHEXT: '',
      },
      stdio: 'pipe',
    }
  );
  let output = '';
  child.stdout.on('data', (bytes) => {
    output += bytes;
  });
  child.stderr.on('data', (bytes) => {
    output += bytes;
  });
  const timer = setTimeout(() => child.kill(), 25000);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve({ code, output }));
    });
  } finally {
    clearTimeout(timer);
  }
}

test(
  'portable network evidence uses private Node, closes real sessions and never leaks or overwrites evidence',
  { timeout: 120000 },
  async () => {
    const address = Object.values(networkInterfaces())
      .flat()
      .find(
        (item) =>
          item &&
          !item.internal &&
          item.family === 'IPv4' &&
          networkAddressSchema.safeParse(item.address).success
      )?.address;
    assert.ok(address, 'An assigned private/VPN IPv4 interface is required.');
    const root = await mkdtemp(join(tmpdir(), 'octopus-network-probe-'));
    const workspace = join(root, 'workspace');
    const product = join(root, 'product');
    await mkdir(workspace);
    const nodeFolder = join(product, 'resources/executor/resources/node');
    await mkdir(nodeFolder, { recursive: true });
    await copyFile(join(project, 'dist/resources/node/node.exe'), join(nodeFolder, 'node.exe'));
    await writeFile(join(workspace, 'network-evidence.txt'), content);
    const native = new NativeFileCommit(join(project, 'dist/native/file-commit.node'));
    const publication = await FilePublication.open(native, root);
    const tools = new BasicTools(publication);
    const store = await ControlStore.open(native, root);
    const authority = new TaskAuthority(tools, store);
    authority.setToolPolicy(policyToolNameSchema.options, 0);
    const gateway = new HttpGateway(authority);
    try {
      const local = await gateway.listen(0, address);
      const grant = await authority.approve({
        label: 'portable probe fixture',
        permissions: ['files.read'],
        waitBudgetMs: 120000,
      });
      const config = join(root, 'private.json');
      const configuration = {
        protocolVersion: '2025-11-25',
        mcpServers: {
          'octopus-executor': {
            url: gateway.remoteEndpoint(),
            headers: { Authorization: 'Bearer ' + grant.token },
          },
        },
      };
      await writeFile(config, JSON.stringify(configuration));
      const kit = await prepareAcceptanceKit(root);
      for (const scenario of ['valid', 'digest mismatch', 'local config', 'oversized config', 'revoked']) {
        if (scenario === 'local config') {
          configuration.mcpServers['octopus-executor'].url = local;
        } else {
          configuration.mcpServers['octopus-executor'].url = gateway.remoteEndpoint();
        }
        await writeFile(config, JSON.stringify(configuration));
        if (scenario === 'oversized config') {
          await writeFile(config, ' '.repeat(16385));
        }
        if (scenario === 'revoked') {
          await authority.revoke(grant.grant.clientId);
          await gateway.revoke(grant.grant.clientId);
        }
        const report = join(root, scenario.replaceAll(' ', '-') + '.json');
        const result = await execute(
          kit,
          product,
          config,
          report,
          scenario === 'digest mismatch' ? '0'.repeat(64) : digest
        );
        const evidenceText = await readFile(report, 'utf8');
        const evidence = JSON.parse(evidenceText);
        assert.equal(result.code, scenario === 'valid' ? 0 : 1, scenario + result.output + evidenceText);
        assert.equal(evidence.passed, scenario === 'valid', scenario);
        assert.equal(evidenceText.includes(grant.token), false);
        assert.equal(result.output.includes(grant.token), false);
        assert.equal(evidenceText.includes(content), false);
        assert.deepEqual(evidence.acceptance, { G4: 'pending', G5: 'pending', G6: 'pending' });
        assert.equal(gateway.connections().length, 0);
        if (scenario === 'valid') {
          assert.equal(evidence.targetIsLocalInterface, true);
          assert.equal(evidence.taskEndConfirmed, true);
          assert.equal(evidence.sessionClosed, true);
          const again = await execute(kit, product, config, report);
          assert.equal(again.code, 1);
          assert.equal(await readFile(report, 'utf8'), evidenceText);
        }
        if (scenario === 'digest mismatch') {
          assert.equal(evidence.checks.fixtureDigestMatches, false);
          assert.equal(evidence.taskEndConfirmed, true);
          assert.equal(evidence.sessionClosed, true);
        }
      }
      await writeFile(join(kit, 'network-probe.cjs'), 'corrupt probe');
      const result = await execute(kit, product, config, join(root, 'corruption.json'));
      assert.equal(result.code, 1);
      await assert.rejects(readFile(join(root, 'corruption.json')));
    } finally {
      await gateway.close();
      await tools.close();
      assert.ok(root.startsWith(join(tmpdir(), 'octopus-network-probe-')));
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
);
