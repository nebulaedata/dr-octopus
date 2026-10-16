/**
 * @author Codex
 * @description Verifies built Basic modules in Electron's actual Utility Node, without adding product test IPC.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';

const appRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

test(
  'Basic reader and edit plan load and run in the built Electron Utility Process',
  { timeout: 60_000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 'octopus-basic-utility-'));
    let app;
    try {
      const root = join(data, 'workspace');
      const script = join(data, 'basic-fixture.cjs');
      await mkdir(root);
      await writeFile(join(root, 'input.txt'), '\ufefffirst\r\n第二😀');
      await build({
        absWorkingDir: appRoot,
        entryPoints: ['test/fixtures/basic-runtime.mjs'],
        outfile: script,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node24',
      });
      app = await electron.launch({
        cwd: appRoot,
        args: [appRoot, '--executor-test', '--executor-test-data=' + join(data, 'user-data')],
        timeout: 30_000,
      });
      const message = await app.evaluate(
        async ({ utilityProcess }, { script, root, binary, nodeHash }) => {
          return new Promise((resolve, reject) => {
            const child = utilityProcess.fork(script, [root, binary, nodeHash], {
              stdio: 'ignore',
              serviceName: 'Basic verification fixture',
            });
            let message;
            const deadline = setTimeout(() => {
              child.kill();
              reject(new Error('Basic Utility fixture timed out.'));
            }, 10_000);
            child.once('message', (value) => {
              message = value;
              child.postMessage('shutdown');
            });
            child.once('exit', (code) => {
              clearTimeout(deadline);
              if (code !== 0 || message === undefined) {
                reject(new Error('Basic Utility fixture exited without a successful response: ' + code));
                return;
              }
              resolve(message);
            });
          });
        },
        {
          script,
          root,
          binary: join(appRoot, 'dist', 'native', 'file-commit.node'),
          nodeHash: await readFile(join(appRoot, 'build/node-resources.hash'), 'utf8'),
        }
      );
      assert.equal(message.ok, true, JSON.stringify(message));
      assert.equal(message.result.first.text, 'first\r\n');
      assert.equal(message.result.first.byteOffset, 3);
      assert.equal(message.result.second.text, '第二😀');
      assert.equal(message.result.second.version, message.result.first.version);
      assert.equal(message.result.deniedCode, 'TASK_NOT_FOUND');
      assert.equal(message.result.edit, 'updated\r\n第二😀');
      assert.equal(message.result.electron, '44.4.5');
      assert.equal(message.result.node, '24.21.0');
      assert.equal(message.result.published.status, 'applied');
      assert.equal(message.result.edited.status, 'applied');
      assert.equal(message.result.edited.replacements, 1);
      assert.equal(message.result.readBack.text, 'final\r\n第二😀');
      assert.equal(message.result.readBack.version, message.result.edited.version);
      assert.equal(message.result.powershell.output, '私有 PowerShell');
      assert.equal(message.result.powershell.terminationReason, 'completed');
      assert.equal(message.result.shellOutput.encoding, 'base64');
      assert.equal(Buffer.from(message.result.shellOutput.text, 'base64').toString(), '私有 PowerShell');
      assert.equal(message.result.found.entries.length, 2);
      assert.equal(message.result.matched.status, 'matches');
      assert.equal(message.result.matched.entries.length, 2);
      assert.ok(message.result.matched.entries.every((entry) => entry.line === 2 && entry.text === '第二😀'));
      assert.equal(message.result.listed.entries.length, 2);
    } finally {
      if (app) {
        await app.close();
      }
      await rm(data, { recursive: true, force: true });
    }
  }
);
