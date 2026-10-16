/**
 * @author Codex
 * @description Verifies build admission against an actually loaded addon and incremental compiler diagnostic decoding.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertNativeOutputsWritable, runNativeCommand } from '../scripts/lib/compile/native-build.mjs';
import { prepareDevelopmentBuild } from '../scripts/lib/compile/development-build.mjs';

test('development conflicts retry only on explicit choice, reuse without rebuild and preserve real build failures', async () => {
  const busy = Object.assign(new Error('locked'), { code: 'EXECUTOR_NATIVE_OUTPUT_BUSY' });
  let builds = 0;
  let reused = 0;
  assert.equal(
    await prepareDevelopmentBuild({
      build: async () => {
        if (++builds === 1) {
          throw busy;
        }
      },
      choose: async () => 'retry',
      reuse: async () => {
        reused++;
      },
    }),
    true
  );
  assert.equal(builds, 2);
  assert.equal(reused, 0);
  assert.equal(
    await prepareDevelopmentBuild({
      build: async () => {
        throw busy;
      },
      choose: async () => 'reuse',
      reuse: async () => {
        reused++;
      },
    }),
    false
  );
  assert.equal(reused, 1);
  assert.equal(
    await prepareDevelopmentBuild({
      build: async () => {
        throw busy;
      },
      choose: async () => 'cancel',
      reuse: async () => {
        assert.fail('cancel must not launch');
      },
    }),
    false
  );
  await assert.rejects(
    prepareDevelopmentBuild({
      build: async () => {
        throw new Error('compiler failed');
      },
      choose: async () => {
        assert.fail('real build failure must not offer reuse');
      },
      reuse: async () => {},
    }),
    /compiler failed/
  );
});

test(
  'native build refuses a loaded destination before changing bytes and succeeds after owner exit',
  { skip: process.platform !== 'win32', timeout: 15000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-build-lock-'));
    let child;
    try {
      await mkdir(join(root, 'dist/native'), { recursive: true });
      const target = join(root, 'dist/native/computer-escape.node');
      await copyFile(fileURLToPath(new URL('../dist/native/computer-escape.node', import.meta.url)), target);
      const before = await readFile(target);
      child = spawn(
        process.execPath,
        [
          '-e',
          "require(process.argv[1]);process.stdout.write('ready');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));",
          target,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );
      await once(child.stdout, 'data');
      await assert.rejects(assertNativeOutputsWritable(root), /完整退出/);
      assert.deepEqual(await readFile(target), before);
      const exited = once(child, 'exit');
      child.stdin.end();
      await exited;
      child = undefined;
      await assertNativeOutputsWritable(root);
      assert.deepEqual(await readFile(target), before);
    } finally {
      if (child) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  }
);

test('compiler diagnostics retain split UTF-8 Chinese and final pipe bytes', async () => {
  const source =
    "const b=Buffer.from('正在创建库：中文路径');let i=0;const timer=setInterval(()=>{if(i<b.length)process.stdout.write(b.subarray(i,i+=1));else{clearInterval(timer);process.stderr.write('完成');}},2);";
  const output = await runNativeCommand(process.execPath, ['-e', source], process.cwd());
  assert.ok(output.includes('正在创建库：中文路径'));
  assert.ok(output.includes('完成'));
  assert.equal(output.includes('\uFFFD'), false);
  await assert.rejects(
    runNativeCommand(
      process.execPath,
      ['-e', "process.stderr.write('编译失败');process.exitCode=2"],
      process.cwd()
    ),
    /Native build failed \(2\): 编译失败/
  );
});
