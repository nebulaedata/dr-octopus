/**
 * @author Codex
 * @description Launches inert runners into owned process scopes and observes scope-wide termination.
 */
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getShellConfig } from '@earendil-works/pi-coding-agent';
import type { ProcessLauncher } from '../definitions/port.js';
import type { ownWindowsRunner } from './windows-job.js';

/**
 * Creates a local launcher without starting processes or timers during extension discovery.
 */
export function createProcessLauncher(): ProcessLauncher {
  return {
    /**
     * Starts trusted runner code first and sends the user command only after scope ownership exists.
     */
    async launch(command, cwd, onData) {
      const shell = getShellConfig();
      if (shell.commandTransport === 'stdin') {
        throw new Error('UNSUPPORTED_SHELL: use a local bash, not WSL');
      }
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      delete env.LD_PRELOAD;
      delete env.DYLD_INSERT_LIBRARIES;
      const compiledRunner = fileURLToPath(new URL('./runner.js', import.meta.url));
      const runner = existsSync(compiledRunner)
        ? compiledRunner
        : fileURLToPath(new URL('./runner.ts', import.meta.url));
      const child = fork(runner, [], {
        cwd,
        env,
        execArgv: [],
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        ...{ windowsHide: true },
      });
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      let exitCode: number | null = null;
      let closed = false;
      child.once('exit', (code) => {
        exitCode = code;
      });
      child.once('close', () => {
        closed = true;
      });
      // Keep later IPC errors handled after the spawn handshake.
      child.on('error', () => undefined);
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      let job: ReturnType<typeof ownWindowsRunner> | undefined;
      try {
        if (process.platform === 'win32') {
          const { ownWindowsRunner } = await import('./windows-job.js');
          job = ownWindowsRunner(child.pid!);
        }
        await new Promise<void>((resolve, reject) => {
          child.send({ ...shell, command, cwd }, (error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        job?.close();
        if (process.platform === 'win32') {
          child.kill('SIGKILL');
        } else {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
        throw error;
      }
      let escalation: NodeJS.Timeout | undefined;
      let finished = false;
      let stopping = false;
      /**
       * Sends signals only to the process group established at launch.
       */
      function signal(value: NodeJS.Signals): void {
        try {
          process.kill(-child.pid!, value);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error;
          }
        }
      }
      const done = new Promise<{ exitCode: number | null }>((resolve, reject) => {
        const timer = setInterval(() => {
          try {
            let active = false;
            if (job) {
              active = job.active();
            } else {
              try {
                process.kill(-child.pid!, 0);
                active = true;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                  throw error;
                }
              }
            }
            if (active || !closed) {
              return;
            }
            finished = true;
            clearInterval(timer);
            clearTimeout(escalation);
            job?.close();
            resolve({ exitCode });
          } catch (error) {
            clearInterval(timer);
            clearTimeout(escalation);
            // Keep the ownership handle for stop/retry; never claim a terminal state after a query failure.
            reject(error instanceof Error ? error : new Error('PROCESS_OBSERVATION_FAILED'));
          }
        }, 50);
      });
      return {
        done,
        /**
         * Terminates the owned scope while leaving exit confirmation to its observer.
         */
        stop() {
          if (finished) {
            return;
          }
          if (job) {
            job.stop();
            return;
          }
          if (stopping) {
            signal('SIGKILL');
            return;
          }
          stopping = true;
          signal('SIGTERM');
          escalation = setTimeout(() => {
            try {
              signal('SIGKILL');
            } catch {
              /* Keep observing; callers report STOP_TIMEOUT if ownership cannot be cleared. */
            }
          }, 3000);
        },
      };
    },
  };
}
