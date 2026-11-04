/**
 * @author Codex
 * @description Configures the bundled current-user Browser Host and resolves finite local extension installation targets.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { browserMaintenanceSchema, type BrowserMaintenance } from '../contracts/browser-maintenance';
import nodePin from '../../vendor/browser-node.json' with { type: 'json' };

const execute = promisify(execFile);

/**
 * Translates allowlisted maintenance codes without forwarding command lines, paths or subprocess stderr to ordinary UI.
 */
export function browserMaintenanceFailure(error: unknown): { code: string; message: string } {
  const messages: Record<string, string> = {
    HOST_CONFIRMATION_REQUIRED: '现有注册或版本需要确认，请使用修复入口查看替换预览。',
    HOST_MAINTENANCE_BUSY: '另一个安装或修复正在运行，请完成后重试。',
    HOST_DIAGNOSTICS_CHANGED: '连接配置已发生变化，请重新检测后再修复。',
    HOST_REGISTRY_WRITE_FAILED: '无法更新浏览器注册，请检查当前用户的注册表权限与浏览器策略后重试。',
    HOST_REGISTRY_INSPECT_FAILED: '无法读取浏览器注册，请检查当前用户的注册表读取权限后重试。',
    HOST_PRIVATE_NODE_INVALID: '随包运行组件校验失败，请使用完整安装包重新安装。',
    HOST_START_FAILED: '连接组件启动验证失败。请更新执行器，再重试修复。',
    HOST_STORAGE_FULL: '磁盘空间不足，请释放空间后重试修复。',
    HOST_STORAGE_ACCESS_DENIED: '无法读写连接维护文件，请检查当前用户对安装目录和执行器数据目录的访问权限。',
    HOST_REPAIR_BLOCKED: '自动维护受到阻止，请查看高级诊断中的策略与文件校验结果。',
    HOST_MAINTENANCE_TIMEOUT: '连接维护已超时并停止，请重新检测后重试。',
    HOST_COMPONENT_MISSING: '连接维护组件缺失，请使用完整安装包重新安装。',
    HOST_REPAIR_FAILED: '连接维护未完成。请查看高级诊断；若诊断也不可用，请使用完整安装包重新安装。',
  };
  let code = 'HOST_REPAIR_FAILED';
  if (error && typeof error === 'object') {
    const nativeCode = 'code' in error ? error.code : undefined;
    if (nativeCode === 10 || nativeCode === 'ETIMEDOUT') {
      code = 'HOST_MAINTENANCE_TIMEOUT';
    } else if (nativeCode === 'ENOENT') {
      code = 'HOST_COMPONENT_MISSING';
    } else {
      const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
      const message = error instanceof Error ? error.message : '';
      const known = Object.keys(messages).find(
        (candidate) => stderr.split(/\r?\n/).includes(candidate) || candidate === message
      );
      if (known) {
        code = known;
      }
    }
  }
  return { code, message: messages[code]! };
}

/**
 * Runs finite maintenance under the native launcher's kill-on-close Job, keeping hashing and registry work off Main.
 */
async function runBrowserMaintenance(
  mode: 'install' | 'inspect',
  resourceRoot: string,
  projectRoot: string,
  signal?: AbortSignal,
  request?: { revision: string; confirmReplacement: boolean }
): Promise<BrowserMaintenance> {
  signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(60000);
  const lifetime = signal ? AbortSignal.any([signal, deadline]) : deadline;
  if (process.platform !== 'win32' || !isAbsolute(resourceRoot) || !isAbsolute(projectRoot)) {
    throw new Error('HOST_LOCAL_DIRECTORY_REQUIRED');
  }
  const launcher = join(resourceRoot, 'native/browser-launcher.exe');
  await Promise.all(
    [
      'native/browser-launcher.exe',
      'native/file-commit.node',
      'setup/browser-host.cjs',
      'setup/browser-registry.ps1',
      'host-bundle.json',
    ].map((path) => access(join(resourceRoot, path)))
  );
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(join(resourceRoot, 'resources/node/node.exe'), {
    signal: lifetime,
  })) {
    digest.update(chunk);
  }
  if (digest.digest('hex') !== nodePin.nodeSha256) {
    throw new Error('HOST_PRIVATE_NODE_INVALID');
  }
  const { stdout } = await execute(
    launcher,
    [
      '--maintain',
      mode,
      projectRoot,
      ...(request ? [Buffer.from(JSON.stringify(request)).toString('base64')] : []),
    ],
    { windowsHide: true, timeout: 60000, maxBuffer: 128 * 1024, signal: lifetime }
  );
  return browserMaintenanceSchema.parse(JSON.parse(stdout.trim().replace(/^\uFEFF/, '')));
}

/**
 * Repairs through the shared publication lease and journal; cancellation terminates the entire owned maintenance process tree.
 */
export async function configureBrowserHost(
  resourceRoot: string,
  projectRoot: string,
  signal?: AbortSignal,
  request?: { revision: string; confirmReplacement: boolean }
): Promise<BrowserMaintenance> {
  return runBrowserMaintenance('install', resourceRoot, projectRoot, signal, request);
}

/**
 * Reads the same evidence used by repair without writing registrations or starting Runtime.
 */
export async function inspectBrowserHost(
  resourceRoot: string,
  projectRoot: string,
  signal?: AbortSignal
): Promise<BrowserMaintenance> {
  return runBrowserMaintenance('inspect', resourceRoot, projectRoot, signal);
}

/**
 * Resolves a complete extension inside the selected bundle without allowing directory escapes.
 */
export async function browserExtensionFolder(
  root: string,
  browser: 'chrome' | 'edge' | 'chrome-mv3' | 'edge-mv3'
): Promise<string> {
  const base = await realpath(root);
  const folder = await realpath(join(base, browser));
  const inside = relative(base, folder);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error('Extension outside bundle');
  }
  await access(join(folder, 'manifest.json'));
  return folder;
}
