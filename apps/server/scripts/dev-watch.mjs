/**
 * @author Codex
 * @description 串行重启开发服务器，确保旧进程完全退出并释放端口后才创建替代进程。
 *
 * 本脚本用于规避在 Windows + pnpm/Turbo monorepo 中实际复现过的以下问题：
 *
 * 1. nodemon 3.1.14 会通过 cmd.exe 包装 --exec 命令。Windows 缺少 wmic 时，其终止逻辑会
 *    回退到异步 taskkill /T /F；包装进程的退出和 Node 子进程释放监听端口之间存在竞态，
 *    nodemon 可能提前启动替代进程，最终触发 EADDRINUSE。
 * 2. node --watch 单独运行 Server 时稳定，但与 Turbo 和 Vite 一起通过 pnpm dev:web 运行时，
 *    会受 workspace 软链接、导入依赖和 Windows 目录通知影响而循环重启。日志中的
 *    “Restarting 'src/index.ts'”仅表示重新执行入口文件，并不证明 index.ts 确实发生了变化；
 *    独立文件系统监控也没有捕获到对应的 Server 源码写入。
 * 3. tsx watch 在单独运行以及与独立 Vite 进程并行时可以正常工作，但在一次 Turbo 托管的
 *    pnpm dev:web 验证中，子进程曾在应用 bootstrap 前挂起，因此不作为可靠的项目入口。
 *
 * 自主实现的 watcher 刻意保持很小，并维护以下不变量：
 *
 * - 只监控 apps/server/src 下的 TypeScript 文件，避免追踪 workspace 依赖和构建缓存。
 * - 使用 process.execPath 直接创建 Node 子进程，不经过 cmd.exe shell 包装。
 * - 编辑器一次保存产生的重复通知会被合并。
 * - 所有重启进入同一条 Promise 链；必须观察到旧子进程 exit 后才能创建新子进程，任何时刻
 *   最多存在一个 Server 子进程。
 * - watcher 与 Server 建立 IPC；正常重启和退出会先请求 Server 主动执行 Fastify shutdown，
 *   IPC 不可用或关闭超时后才强制终止进程。
 * - Server 因 Ctrl+C 等非计划原因自行正常退出时，watcher 会同步退出，避免 Turbo 一直等待
 *   persistent task；计划内重启则由重启链创建替代进程。
 * - 调用方参数会原样放在 Node 子进程参数前部；例如 package.json 可从外部传入
 *   --env-file-if-exists，而无需在本脚本中写死环境文件路径。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, watch } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_DIRECTORY = join(SERVER_DIRECTORY, 'src');
const RESTART_DELAY_MS = 100;
const FORCE_STOP_DELAY_MS = 5_000;
const DEV_WATCH_SHUTDOWN_MESSAGE_TYPE = 'octopus:dev-watch:shutdown';
// External Node flags must precede --import and the entrypoint to retain Node CLI semantics.
const SERVER_ARGUMENTS = [...process.argv.slice(2), '--import', 'tsx', 'src/index.ts'];

let activeChild;
let plannedStopReason;
let restartTimer;
let restartChain = Promise.resolve();
let shuttingDown = false;
let sourceSnapshot = createSourceSnapshot();

/**
 * Produces a content-addressed snapshot of every TypeScript source watched by this process.
 *
 * Windows can emit directory notifications even when a source file was only inspected by
 * another process. Hashing paths and contents keeps those notifications from restarting the
 * Server while still detecting source creation, deletion, rename, and content changes.
 *
 * @returns Stable digest for the current TypeScript source tree.
 */
function createSourceSnapshot() {
  const hash = createHash('sha256');
  updateSourceSnapshotHash(hash, SOURCE_DIRECTORY);
  return hash.digest('hex');
}

/**
 * Adds one directory's TypeScript paths and contents to a source snapshot in stable order.
 *
 * @param {import('node:crypto').Hash} hash Snapshot digest being assembled.
 * @param {string} directory Directory currently being traversed.
 */
function updateSourceSnapshotHash(hash, directory) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      updateSourceSnapshotHash(hash, entryPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }
    hash.update(relative(SOURCE_DIRECTORY, entryPath).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(entryPath));
    hash.update('\0');
  }
}

/**
 * Starts one server child directly without a cmd.exe wrapper.
 */
function startServer() {
  if (shuttingDown) {
    return;
  }

  const child = spawn(process.execPath, SERVER_ARGUMENTS, {
    cwd: SERVER_DIRECTORY,
    env: process.env,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });
  activeChild = child;
  child.once('error', (error) => {
    console.error('[dev-watch] Failed to start the server process.', error);
  });
  child.once('exit', (code, signal) => {
    const stopReason = plannedStopReason;
    plannedStopReason = undefined;
    if (activeChild === child) {
      activeChild = undefined;
    }
    if (!shuttingDown && stopReason === undefined && code === 0) {
      void shutdown(0);
      return;
    }
    if (!shuttingDown && code !== null && code !== 0) {
      console.error(
        `[dev-watch] Server exited with code ${String(code)}${signal === null ? '' : ` (${signal})`}; waiting for source changes.`
      );
    }
  });
}

/**
 * Stops the active child and resolves only after the operating system reports its exit.
 *
 * @param {'restart' | 'shutdown'} reason Development lifecycle event sent to the Server.
 */
async function stopServer(reason) {
  const child = activeChild;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  plannedStopReason = reason;
  await new Promise((resolve) => {
    // IPC lets the Server own resource cleanup; SIGKILL only bounds a stuck development restart.
    const forceStopTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, FORCE_STOP_DELAY_MS);
    child.once('exit', () => {
      clearTimeout(forceStopTimer);
      resolve();
    });
    if (child.connected) {
      child.send({ type: DEV_WATCH_SHUTDOWN_MESSAGE_TYPE, reason }, (error) => {
        if (error !== null && child.exitCode === null) {
          child.kill('SIGTERM');
        }
      });
    } else if (!child.kill('SIGTERM')) {
      clearTimeout(forceStopTimer);
      resolve();
    }
  });
}

/**
 * Replaces the server only after the previous child has fully exited.
 */
async function restartServer() {
  await stopServer('restart');
  startServer();
}

/**
 * Coalesces duplicate filesystem notifications emitted by one editor save.
 *
 */
function scheduleRestart() {
  if (shuttingDown) {
    return;
  }

  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    let nextSourceSnapshot;
    try {
      nextSourceSnapshot = createSourceSnapshot();
    } catch (error) {
      // Atomic directory replacements can make one traversal observe a path after it vanished.
      // A later notification will retry without crashing or putting the watcher in a busy loop.
      console.warn('[dev-watch] Source snapshot was temporarily unavailable.', error);
      return;
    }
    if (nextSourceSnapshot === sourceSnapshot) {
      return;
    }
    sourceSnapshot = nextSourceSnapshot;
    // Serializing on one chain prevents later filesystem events from overlapping an active restart.
    restartChain = restartChain.then(restartServer).catch((error) => {
      console.error('[dev-watch] Server restart failed.', error);
    });
  }, RESTART_DELAY_MS);
}

/**
 * Stops watching and waits for the owned server child before exiting.
 *
 * @param exitCode Exit status for the watcher process.
 */
async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearTimeout(restartTimer);
  sourceWatcher.close();
  await restartChain;
  await stopServer('shutdown');
  process.exit(exitCode);
}

const sourceWatcher = watch(SOURCE_DIRECTORY, { recursive: true }, () => {
  scheduleRestart();
});

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

startServer();
