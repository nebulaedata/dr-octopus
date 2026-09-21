/**
 * @author Codex
 * @description Windows broker guard regressions for ambient Jobs, restrictive Jobs and launch identity failures.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { permitsBrokerJob } from '../dist/lib/daemon-platform/windows-broker-policy.js';
const run = promisify(execFile);

test('only the known non-restrictive ambient Job is permitted after WMI isolation', () => {
  assert.equal(permitsBrokerJob(0x1800), true);
  for (const flags of [undefined, 0, 0x800, 0x1000, 0x3800, 0x1808, 0x1840, 0x9800]) {
    assert.equal(permitsBrokerJob(flags), false);
  }
});

test(
  'guard writes explicit receipts and blocks business code on native or identity failures',
  {
    skip: process.platform !== 'win32',
    timeout: 30000,
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'octopus-broker-guard-test-'));
    t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    const cases = [
      ['no-job', true],
      ['6144', true],
      ['14336', false],
      ['6152', false],
      ['query-failure', false],
      ['membership-failure', false],
      ['wrong-user', false],
    ];
    for (const [scenario, accepted] of cases) {
      const receipt = join(directory, scenario + '.json');
      const marker = join(directory, scenario + '.entry');
      let exitCode = 0;
      try {
        await run(
          process.execPath,
          [
            fileURLToPath(new URL('./fixtures/windows-broker-guard-child.mjs', import.meta.url)),
            scenario,
            marker,
          ],
          {
            windowsHide: true,
            timeout: 5000,
            env: {
              ...process.env,
              OCTOPUS_PROCESS_LAUNCH_RECEIPT: receipt,
              OCTOPUS_PROCESS_LAUNCH_NONCE: 'test-nonce',
              OCTOPUS_PROCESS_LAUNCH_USER:
                scenario === 'wrong-user' ? 'not-the-launcher' : userInfo().username,
            },
          }
        );
      } catch (error) {
        exitCode = error.code;
      }
      assert.equal(exitCode, accepted ? 0 : 1, scenario);
      const value = JSON.parse(await readFile(receipt, 'utf8'));
      assert.equal(value.nonce, 'test-nonce');
      assert.ok(Number.isInteger(value.pid));
      if (accepted) {
        assert.equal(value.error, undefined);
        assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), {});
      } else {
        assert.match(value.error, /Broker process/);
        await assert.rejects(readFile(marker), { code: 'ENOENT' });
      }
    }
  }
);
