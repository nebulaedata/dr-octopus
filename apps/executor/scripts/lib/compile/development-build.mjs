/**
 * @author Codex
 * @description Resolves occupied native outputs interactively before development compilation, with explicit reuse or retry.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Waits for the exact owned Electron helper and never terminates another application.
 */
function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', resolve);
  });
}

/**
 * Shows native UI independently of the blocked application bundle; returns one finite user choice.
 */
export async function chooseBuildConflict(electron) {
  const data = await mkdtemp(join(tmpdir(), 'octopus-build-dialog-'));
  try {
    const code = await run(electron, [
      fileURLToPath(new URL('./build-conflict-dialog.mjs', import.meta.url)),
      data,
    ]);
    if (code === 10) {
      return 'reuse';
    }
    if (code === 11) {
      return 'retry';
    }
    if (code === 12) {
      return 'cancel';
    }
    throw new Error('开发启动提示无法显示，请完整退出 Executor 后重试。');
  } finally {
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * Rechecks after each retry; reuse activates the existing single-instance app without overwriting its binaries.
 * Non-occupancy failures remain failures and cannot be mistaken for a successful build.
 */
export async function prepareDevelopmentBuild({ build, choose, reuse }) {
  while (true) {
    try {
      await build();
      return true;
    } catch (error) {
      const nativeCopyConflict =
        ['EBUSY', 'EPERM', 'EACCES'].includes(error.code) &&
        error.syscall === 'copyfile' &&
        /[\\/]dist[\\/]native[\\/][^\\/]+\.(node|exe)$/i.test(error.dest ?? '');
      if (error.code !== 'EXECUTOR_NATIVE_OUTPUT_BUSY' && !nativeCopyConflict) {
        throw error;
      }
      const action = await choose();
      if (action === 'retry') {
        continue;
      }
      if (action === 'reuse') {
        await reuse();
      }
      return false;
    }
  }
}

/**
 * Requests activation through Electron's existing single-instance protocol, never guessing a process to kill.
 */
export async function reuseDevelopmentApp(electron, root) {
  await access(join(root, 'dist/main/index.js'));
  const code = await run(electron, [root]);
  if (code !== 0) {
    throw new Error('已有执行器未能正常打开，请检查运行实例。');
  }
}
