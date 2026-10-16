/**
 * @author Codex
 * @description Checks native build destinations before compilation and decodes bounded UTF-8 compiler diagnostics.
 */
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

/**
 * Detects loaded Windows binaries without changing bytes, before any build output is replaced.
 * Does not terminate applications or assume that a window being closed means its process exited.
 */
export async function assertNativeOutputsWritable(root) {
  for (const directory of ['build/native', 'dist/native']) {
    for (const name of [
      'stdio-exit.node',
      'computer-escape.node',
      'file-commit.node',
      'process-supervisor.exe',
      'browser-launcher.exe',
      'computer-supervisor.exe',
      'mcp-launcher.exe',
    ]) {
      const path = join(root, directory, name);
      try {
        const handle = await open(path, 'r+');
        await handle.close();
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue;
        }
        if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
          const failure = new Error(
            `无法构建 Executor：原生文件正被占用或不可写：${path}\n请从系统托盘完整退出此项目的 Executor，并停止使用该构建目录的 MCP/浏览器适配器后重试。仅关闭窗口可能仍在后台运行；构建不会自动终止其他进程。`,
            { cause: error }
          );
          failure.code = 'EXECUTOR_NATIVE_OUTPUT_BUSY';
          throw failure;
        }
        throw error;
      }
    }
  }
}

/**
 * Drains both UTF-8 streams through independent incremental decoders and waits for pipe closure.
 * Keeps bounded diagnostic tails and rejects nonzero exit codes without treating partial output as success.
 */
export async function runNativeCommand(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (text) => {
      output = (output + text).slice(-64 * 1024);
    };
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8');
      stream.on('data', (chunk) => append(decoder.write(chunk)));
      stream.on('end', () => append(decoder.end()));
    }
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Native build failed (${code}): ${output}`));
      } else {
        resolve(output);
      }
    });
  });
}
