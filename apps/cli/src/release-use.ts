/**
 * @author Codex
 * @description Checks whether the configured Scheduler is still executing code from the release being installed.
 */
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execute } from './process.js';
import { dataDirectory, releasePaths } from './paths.js';
import { gatewayError } from './gateway/index.js';
import { acquireLease } from './gateway/lease.js';
import { basename, dirname, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import type Koffi from 'koffi';

/**
 * Hold the exclusive counterpart of every knowledge daemon's shared release lease throughout installation.
 * This covers custom Agent profiles and does not need installed Agent SDK dependencies.
 */
export async function acquireKnowledgeReleaseInstallGuard(
  root: string,
  runtimeCliDir?: string
): Promise<() => void> {
  const canonical = await realpath(root).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return join(await realpath(dirname(root)), basename(root));
  });
  let native: typeof Koffi;
  try {
    native = createRequire(runtimeCliDir ? join(runtimeCliDir, 'package.json') : import.meta.url)(
      'koffi'
    ) as typeof Koffi;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
    const carrierAbsent = await access(canonical + '.knowledge-use.lock').then(
      () => false,
      (fault: NodeJS.ErrnoException) => {
        if (fault.code !== 'ENOENT') {
          throw fault;
        }
        return true;
      }
    );
    // A first installation has never had an owner. Its existing .install.lock also fences new daemon starts.
    if (missing && carrierAbsent) {
      await access(canonical + '.install.lock');
      return () => undefined;
    }
    throw gatewayError(
      'RELEASE_USE_UNVERIFIED',
      'Cannot load the native lock needed to verify this existing runtime.'
    );
  }
  try {
    return acquireLease(canonical + '.knowledge-use.lock', native);
  } catch {
    throw gatewayError(
      'RELEASE_IN_USE',
      'Stop all knowledge services using this release before installing dependencies.'
    );
  }
}

/**
 * Refuses to replace a known live Scheduler's dependencies while keeping first installation dependency-free.
 */
export async function assertSchedulerReleaseIdle(
  root: string,
  sdkRoot = releasePaths(root).cli
): Promise<void> {
  const directory = dataDirectory(process.env['DR_OCTOPUS_CODING_AGENT_DIR'], 'agent');
  const result = await execute(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import { access } from 'node:fs/promises';
    import { fileURLToPath } from 'node:url';
    let entry;
    try {
      entry = import.meta.resolve('@octopus/agent');
      await access(fileURLToPath(entry));
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'ENOENT') throw error;
      console.log('SCHEDULER=' + JSON.stringify({ state: 'not-installed' }));
      process.exit(0);
    }
    const {getSchedulerServiceStatus} = await import(entry);
    console.log('SCHEDULER=' + JSON.stringify(await getSchedulerServiceStatus(${JSON.stringify(directory)})));
  `,
    ],
    sdkRoot
  );
  const line = result.split(/\r?\n/).find((line) => line.startsWith('SCHEDULER='));
  if (!line) {
    throw gatewayError(
      'RELEASE_USE_UNVERIFIED',
      'Could not verify Scheduler before dependency installation.'
    );
  }
  const status = JSON.parse(line.slice(10)) as { state: string; pid?: number };
  if (status.state === 'unavailable') {
    await assertUnavailableSchedulerIdle(directory);
    return;
  }
  if (status.state !== 'control-ready' || !Number.isSafeInteger(status.pid)) {
    return;
  }
  const pid = String(status.pid);
  const commandLine =
    process.platform === 'win32'
      ? await execute(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
          ],
          sdkRoot
        )
      : process.platform === 'linux'
        ? await readFile(`/proc/${pid}/cmdline`, 'utf8')
        : await execute('ps', ['-p', pid, '-o', 'args='], sdkRoot);
  if (
    commandLine
      .replaceAll('\\', '/')
      .toLowerCase()
      .includes(root.replaceAll('\\', '/').toLowerCase() + '/')
  ) {
    throw gatewayError(
      'RELEASE_IN_USE',
      'Stop the Scheduler using this release before installing dependencies.'
    );
  }
}

/**
 * Verify an unreachable Scheduler has no lock owner; stale discovery alone does not imply a live daemon.
 * Resolve the same canonical profile as the Scheduler and fail closed if its lock cannot be checked.
 * Preserve metadata and stopped intent; this check does not stop or restart any service.
 */
async function assertUnavailableSchedulerIdle(agentDirectory: string): Promise<void> {
  try {
    const canonical = await realpath(agentDirectory);
    const carrier = join(dirname(canonical), 'scheduler', 'daemon.lock');
    await access(carrier);
    const release = acquireLease(carrier);
    release();
  } catch {
    throw gatewayError(
      'RELEASE_USE_UNVERIFIED',
      'Scheduler is unavailable and its lifecycle lock could not be acquired; stop it before replacing release assets.'
    );
  }
}
