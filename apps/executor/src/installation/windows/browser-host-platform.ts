/**
 * @author Codex
 * @description Adapts finite Browser maintenance operations to Windows registry views and a crash-released native mutex.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { hostBundleSchema } from '../../contracts/browser-host-bundle';
import { z } from 'zod';
import {
  browserDigest,
  registryRecordSchema,
  type BrowserRegistry,
  type RegistryRecord,
} from '../../maintenance/browser-host';

const execute = promisify(execFile);
const heldLeases = new Set<string>();

/**
 * Resolves a physical existing local DOS directory without changing its contents or ACL.
 */
export async function browserHostDirectory(path: string): Promise<string> {
  if (process.platform !== 'win32' || !isAbsolute(path)) {
    throw new Error('HOST_LOCAL_DIRECTORY_REQUIRED');
  }
  const resolved = await realpath(path);
  if (!/^[A-Za-z]:\\/.test(resolved) || !(await lstat(resolved)).isDirectory()) {
    throw new Error('HOST_LOCAL_DIRECTORY_REQUIRED');
  }
  return resolved;
}

/**
 * Uses the system PowerShell executable and fixed bundled script, with bounded output and no command interpolation.
 */
export function windowsBrowserRegistry(resourceRoot: string): BrowserRegistry {
  /**
   * Executes one allowlisted adapter operation; all arguments originate in Main-owned maintenance state.
   */
  async function command(mode: string, hostName: string, record?: RegistryRecord, path?: string) {
    const windowsRoot = process.env.SystemRoot;
    if (process.platform !== 'win32' || !windowsRoot || !isAbsolute(windowsRoot)) {
      throw new Error('HOST_WINDOWS_REQUIRED');
    }
    return execute(
      join(windowsRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(resourceRoot, 'setup/browser-registry.ps1'),
        '-Mode',
        mode,
        '-HostName',
        hostName,
        ...(record
          ? [
              '-Browser',
              record.browser,
              '-View',
              record.view,
              '-ManifestPath',
              path!,
              '-ExpectedPath',
              record.path ?? '',
            ]
          : []),
      ],
      { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024, encoding: 'utf8' }
    ).catch((error: unknown) => {
      const code = mode === 'inspect' ? 'HOST_REGISTRY_INSPECT_FAILED' : 'HOST_REGISTRY_WRITE_FAILED';
      throw new Error(code, { cause: error });
    });
  }
  return {
    /**
     * Rejects incomplete, duplicate or malformed registry evidence before an ownership decision.
     */
    async inspect(hostName) {
      const { stdout } = await command('inspect', hostName);
      const records = z
        .array(registryRecordSchema)
        .length(8)
        .parse(JSON.parse(stdout.replace(/^\uFEFF/, '')));
      if (new Set(records.map((item) => `${item.browser}:${item.hive}:${item.view}`)).size !== 8) {
        throw new Error('HOST_REGISTRY_INCOMPLETE');
      }
      return records;
    },
    /**
     * Writes one user view and never modifies machine policy.
     */
    async set(hostName, record, path) {
      if (record.hive !== 'CurrentUser') {
        throw new Error('HOST_MACHINE_REGISTRY_READ_ONLY');
      }
      await command('set', hostName, record, path);
    },
    /**
     * The adapter checks the current target again before removal.
     */
    async remove(hostName, record, path) {
      if (record.hive !== 'CurrentUser') {
        throw new Error('HOST_MACHINE_REGISTRY_READ_ONLY');
      }
      await command('remove', hostName, record, path);
    },
  };
}

/**
 * Serializes installers and running versions. OS ownership disappears after a crash, without stale lock-file deletion.
 */
export async function withBrowserMaintenanceLease<T>(
  resourceRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const bundle = hostBundleSchema.parse(
    JSON.parse(await readFile(join(resourceRoot, 'host-bundle.json'), 'utf8'))
  );
  const identity = browserDigest(bundle.hostName);
  if (heldLeases.has(identity)) {
    throw new Error('HOST_MAINTENANCE_BUSY');
  }
  const backend = z
    .object({
      lockMaintenance: z.custom<(identity: string) => unknown>((value) => typeof value === 'function'),
      releaseMaintenance: z.custom<(lease: unknown) => void>((value) => typeof value === 'function'),
    })
    .parse(
      createRequire(join(resourceRoot, 'native/file-commit.node'))(
        join(resourceRoot, 'native/file-commit.node')
      )
    );
  const lease = backend.lockMaintenance(identity);
  heldLeases.add(identity);
  try {
    return await operation();
  } finally {
    backend.releaseMaintenance(lease);
    heldLeases.delete(identity);
  }
}
