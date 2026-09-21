/**
 * @author Codex
 * @description Verifies the compiled CLI-owned host adapts Server startup, cancellation and failure to authenticated control.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { getGatewayStatus, readGatewayIdentity, requestGateway } from '../src/gateway/client.ts';

for (const mode of ['ready', 'pending', 'fail', 'restart']) {
  test(
    `Compiled Gateway handles ${mode} Server lifecycle and releases ownership`,
    { timeout: 15000 },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), 'octopus-gateway-host-'));
      const directory = join(home, '.dr-octopus', 'server', 'state', 'gateway');
      const key = createHash('sha256').update(directory).digest('hex').slice(0, 24);
      const paths = {
        directory,
        record: join(directory, 'instance.json'),
        endpoint:
          process.platform === 'win32'
            ? `\\\\.\\pipe\\octopus-gateway-${key}`
            : join(directory, 'control.sock'),
      };
      const child = spawn(
        process.execPath,
        [
          '--experimental-test-module-mocks',
          '--import',
          new URL('./fixtures/gateway-runtime.mjs', import.meta.url).href,
          fileURLToPath(new URL('../dist/gateway.mjs', import.meta.url)),
        ],
        {
          env: { ...process.env, OCTOPUS_TEST_HOME: home, OCTOPUS_TEST_START: mode },
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
        }
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const exited = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolve(code));
      });
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await exited;
        await rm(home, { recursive: true, force: true });
      });
      if (mode !== 'fail') {
        let status;
        const deadline = Date.now() + 8000;
        do {
          status = await getGatewayStatus(paths);
          if (
            status?.warnings.includes('fixture warning') &&
            (mode === 'pending' || status.state === 'running')
          )
            break;
          assert.equal(child.exitCode, null, stderr);
          await delay(25);
        } while (Date.now() < deadline);
        assert.ok(status?.warnings.includes('fixture warning'), stderr);
        assert.equal(status.pid, child.pid);
        assert.equal(status.state, mode === 'pending' ? 'starting' : 'running');
        assert.equal(status.dataDir, home);
        if (mode === 'restart') {
          const identity = status.instanceId;
          assert.equal((await fetch(status.address, { method: 'POST' })).status, 202);
          const restartDeadline = Date.now() + 5000;
          do {
            status = await getGatewayStatus(paths);
            const events = await readFile(join(home, 'events'), 'utf8');
            if (status?.state === 'running' && events === 'start\nclose\nstart\n') break;
            await delay(25);
          } while (Date.now() < restartDeadline);
          assert.equal(status.instanceId, identity);
          assert.equal(status.state, 'running');
          assert.equal(await readFile(join(home, 'events'), 'utf8'), 'start\nclose\nstart\n');
        }
        await requestGateway(await readGatewayIdentity(paths), 'stop', paths);
      }
      assert.equal(await exited, mode === 'fail' ? 1 : 0, stderr);
      assert.equal(await getGatewayStatus(paths), null);
      assert.equal(
        await readFile(join(home, 'events'), 'utf8'),
        mode === 'restart' ? 'start\nclose\nstart\nclose\n' : 'start\nclose\n'
      );
    }
  );
}
