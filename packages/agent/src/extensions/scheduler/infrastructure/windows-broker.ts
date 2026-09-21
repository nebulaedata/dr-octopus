/**
 * @author Codex
 * @description One-shot local WMI launcher with pre-entry verification, no resident broker or shell interpolation.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SchedulerLifecycleError } from '../definitions/lifecycle.js';
import { pathToFileURL } from 'node:url';
import { resolveSchedulerDaemonEntry } from './daemon-entry.js';

const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $startup = New-CimInstance -Namespace root/cimv2 -ClassName Win32_ProcessStartup -ClientOnly -Property @{
    ShowWindow = [uint16]0
    CreateFlags = [uint32]150995968
    EnvironmentVariables = [string[]]$request.environment
  }
  $result = Invoke-CimMethod -Namespace root/cimv2 -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = [string]$request.command
    CurrentDirectory = [string]$request.cwd
    ProcessStartupInformation = $startup
  }
  @{ code = $result.ReturnValue; pid = $result.ProcessId } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine('Scheduler WMI launch failed'); exit 1 }
`;

/**
 * Run the fixed local helper; request values travel as JSON over stdin, never as PowerShell code.
 */
function invokeBroker(request: object): Promise<{ code: number; pid: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000, maxBuffer: 65536 },
      (error, stdout) => {
        if (error) {
          reject(
            new SchedulerLifecycleError('SCHEDULER_DETACH_UNSUPPORTED', 'Local WMI launcher unavailable')
          );
          return;
        }
        try {
          const value = JSON.parse(stdout) as { code?: unknown; pid?: unknown };
          if (
            value.code !== 0 ||
            typeof value.pid !== 'number' ||
            !Number.isInteger(value.pid) ||
            value.pid <= 0
          ) {
            throw new Error('Invalid launch result');
          }
          resolve({ code: 0, pid: value.pid });
        } catch {
          reject(
            new SchedulerLifecycleError('SCHEDULER_DETACH_UNSUPPORTED', 'Local WMI launcher refused creation')
          );
        }
      }
    );
    child.stdin?.on('error', () => {
      /* Callback reports process failure without exposing request data. */
    });
    child.stdin?.end(JSON.stringify(request));
  });
}

/**
 * Start via Windows' existing local process service and wait for the child's verified receipt.
 * The guard refuses different users and all Job membership before executing the requested entry.
 */
export async function launchWindowsBroker(
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  quote: (value: string) => string
): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-launch-'));
  const receipt = join(directory, 'receipt.json');
  const nonce = randomBytes(32).toString('hex');
  try {
    const env = {
      ...environment,
      OCTOPUS_SCHEDULER_LAUNCH_RECEIPT: receipt,
      OCTOPUS_SCHEDULER_LAUNCH_NONCE: nonce,
      OCTOPUS_SCHEDULER_LAUNCH_USER: userInfo().username,
    };
    const command = [
      process.execPath,
      '--import',
      new URL('../infrastructure/windows-broker-guard.js', pathToFileURL(await resolveSchedulerDaemonEntry()))
        .href,
      ...args,
    ]
      .map(quote)
      .join(' ');
    const result = await invokeBroker({
      command,
      cwd,
      environment: Object.entries(env)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([key, value]) => `${key}=${value}`),
    });
    const deadline = Date.now() + 10000;
    do {
      try {
        const value = JSON.parse(await readFile(receipt, 'utf8')) as { nonce?: unknown; pid?: unknown };
        if (value.nonce === nonce && value.pid === result.pid) {
          return result.pid;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) {
          throw error;
        }
      }
      await delay(50);
    } while (Date.now() < deadline);
    throw new SchedulerLifecycleError(
      'SCHEDULER_DETACH_UNSUPPORTED',
      'Broker process did not verify independent startup'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
