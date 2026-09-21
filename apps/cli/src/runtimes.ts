/**
 * @author Codex
 * @description Inventories managed runtimes and prunes only identified, inactive releases under the configured root.
 */
import { lstat, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { distribution, runtimeDirectory } from './distribution/location.js';
import { insidePath, readReleaseLayout } from './distribution/config.js';
import { acquireInstallLock, installLockPath } from './distribution/install-lock.js';
import { referencesRuntime, runtimeProcesses } from './distribution/runtime-processes.js';
import { getGatewayStatus, isProcessAlive } from './gateway/index.js';
import { acquireKnowledgeReleaseInstallGuard } from './release-use.js';
import type { Distribution } from './distribution/location.js';
import type { OutputOptions } from './output.js';

export interface RuntimeEntry {
  name: string;
  directory: string;
  version?: string;
  sizeBytes: number;
  current: boolean;
  status: 'current' | 'unused' | 'in-use' | 'unverified' | 'removed' | 'would-remove';
  reason?: string;
}

export interface RuntimeOptions extends OutputOptions {
  dryRun?: boolean;
}

/**
 * Counts regular file lengths without following dependency symlinks or junctions.
 * This is logical size, not physical disk allocation; hard-linked files can share storage.
 */
async function directorySize(root: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      continue;
    }
    if (info.isDirectory()) {
      bytes += await directorySize(path);
    } else if (info.isFile()) {
      bytes += info.size;
    }
  }
  return bytes;
}

/**
 * Requires a real direct child and matching payload identity before it can become a deletion candidate.
 */
async function identify(root: string, directory: string): Promise<string> {
  if (
    dirname(resolve(directory)) !== root ||
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  ) {
    throw new Error('Runtime must be a real direct child directory.');
  }
  const digest = await readFile(join(directory, '.payload-sha256'), 'utf8');
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    !new RegExp(`^${digest.slice(0, 24)}-[a-z0-9]+-[a-z0-9]+-\\d+$`).test(basename(directory))
  ) {
    throw new Error('Unrecognized runtime payload identity.');
  }
  return readReleaseLayout(join(directory, 'release-layout.json')).version;
}

/**
 * Keeps live or ambiguous installation locks; a provably dead installer can be recovered by prune.
 */
async function installerActive(directory: string): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(installLockPath(directory), 'utf8')) as {
      pid: number;
      token: string;
    };
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.token !== 'string') {
      throw new Error('Invalid installer lock.');
    }
    return isProcessAlive(record.pid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Lists recognized and unknown directories, retaining inspection errors as explicit skip reasons.
 * The optional context and home allow isolated fixtures without touching a real user's runtimes.
 */
export async function listRuntimes(context: Distribution = distribution(), home = userInfo().homedir) {
  const configured = insidePath(home, context.layout.runtimeDirectory);
  let root: string;
  try {
    root = await realpath(configured);
    if ((await lstat(configured)).isSymbolicLink() || root !== resolve(configured)) {
      throw new Error('Refusing a redirected runtime root.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { directory: configured, sizeBytes: 0, runtimes: [] as RuntimeEntry[] };
    }
    throw error;
  }
  const current = context.packaged ? join(root, basename(runtimeDirectory(context))) : undefined;
  let users: string[] = [];
  let inspectionError: string | undefined;
  try {
    users = await runtimeProcesses();
    const gateway = await getGatewayStatus();
    if (gateway) {
      users.push(gateway.entryPath);
    }
  } catch (error) {
    inspectionError = String(error);
  }
  const runtimes: RuntimeEntry[] = [];
  for (const item of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (!item.isDirectory() && !item.isSymbolicLink()) {
      continue;
    }
    const directory = join(root, item.name);
    const entry: RuntimeEntry = {
      name: item.name,
      directory,
      sizeBytes: 0,
      current: directory === current,
      status: 'unverified',
    };
    try {
      entry.version = await identify(root, directory);
      entry.sizeBytes = await directorySize(directory);
      if (entry.current) {
        entry.status = 'current';
      } else if (await installerActive(directory)) {
        entry.status = 'in-use';
        entry.reason = 'Dependency installation is running.';
      } else if (inspectionError) {
        entry.reason = inspectionError;
      } else if (users.some((command) => referencesRuntime(command, directory))) {
        entry.status = 'in-use';
        entry.reason = 'A running process references this runtime.';
      } else {
        entry.status = 'unused';
      }
    } catch (error) {
      entry.reason = String(error);
    }
    runtimes.push(entry);
  }
  return {
    directory: root,
    sizeBytes: runtimes.reduce((total, entry) => total + entry.sizeBytes, 0),
    runtimes,
  };
}

/**
 * Rechecks identity and usage while holding the installer and knowledge guards before each deletion.
 * Dry runs perform no writes; failures retain a directory with a reason and allow other candidates to proceed.
 */
export async function pruneRuntimes(
  options: RuntimeOptions,
  context: Distribution = distribution(),
  home = userInfo().homedir
) {
  const inventory = await listRuntimes(context, home);
  let reclaimedBytes = 0;
  for (const entry of inventory.runtimes) {
    if (entry.current || entry.status !== 'unused') {
      continue;
    }
    if (options.dryRun) {
      entry.status = 'would-remove';
      reclaimedBytes += entry.sizeBytes;
      continue;
    }
    let unlock: (() => Promise<void>) | undefined;
    let releaseGuard: (() => void) | undefined;
    try {
      await identify(inventory.directory, entry.directory);
      unlock = await acquireInstallLock(entry.directory);
      releaseGuard = await acquireKnowledgeReleaseInstallGuard(
        entry.directory,
        join(runtimeDirectory(context), context.layout.paths.cli)
      );
      const users = await runtimeProcesses();
      const gateway = await getGatewayStatus();
      if (gateway) {
        users.push(gateway.entryPath);
      }
      if (users.some((command) => referencesRuntime(command, entry.directory))) {
        entry.status = 'in-use';
        entry.reason = 'A running process references this runtime.';
        continue;
      }
      await identify(inventory.directory, entry.directory);
      await rm(entry.directory, { recursive: true });
      entry.status = 'removed';
      reclaimedBytes += entry.sizeBytes;
    } catch (error) {
      entry.status = 'unverified';
      entry.reason = String(error);
    } finally {
      releaseGuard?.();
      await unlock?.();
    }
  }
  return { ...inventory, dryRun: Boolean(options.dryRun), reclaimedBytes };
}
