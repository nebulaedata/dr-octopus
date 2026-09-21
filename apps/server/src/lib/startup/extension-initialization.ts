/**
 * @author Codex
 * @description Owns the startup installer subprocess and cancels its npm children without touching Scheduler processes.
 */
import { fork, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAgentEnvironmentStore } from '@octopus/agent/environment';
import type { ForkOptions } from 'node:child_process';
import type { EnsureExtensionsResult } from '@octopus/agent';

/**
 * Runs the Agent installer in a disposable process, returning only serializable installation diagnostics.
 */
export async function initializeExtensions(
  agentDir: string,
  signal: AbortSignal
): Promise<EnsureExtensionsResult> {
  signal.throwIfAborted();
  const development = import.meta.url.endsWith('.ts');
  const entry = fileURLToPath(
    new URL(development ? './extension-init-child.ts' : './extension-init-child.js', import.meta.url)
  );
  const options: ForkOptions & { windowsHide: boolean } = {
    // Agent installer options (for example registry/proxy values) belong only to this child.
    env: {
      ...createAgentEnvironmentStore(agentDir).load().values,
      DR_OCTOPUS_CODING_AGENT_DIR: agentDir,
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
    detached: process.platform !== 'win32',
    execArgv: development
      ? ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href]
      : [],
  };
  const child = fork(entry, [], options);
  return new Promise((resolve, reject) => {
    let result: EnsureExtensionsResult | undefined;
    let failure: Error | undefined;
    const abort = () => {
      failure = new Error('Extension initialization cancelled');
      if (child.pid && child.exitCode === null) {
        if (process.platform === 'win32') {
          // This dedicated installer cannot own Agent RPC or shared Scheduler children.
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () =>
            child.kill()
          );
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => {
      failure = error;
    });
    child.once('message', (message: { result?: EnsureExtensionsResult; error?: string }) => {
      result = message.result;
      if (message.error) {
        failure = new Error(message.error);
      }
    });
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (failure) {
        reject(failure);
      } else if (code === 0 && result) {
        resolve(result);
      } else {
        reject(new Error(`Extension installer exited without a result (${String(code)})`));
      }
    });
    child.send({ agentDir });
    if (signal.aborted) {
      abort();
    }
  });
}
