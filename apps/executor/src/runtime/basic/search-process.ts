/**
 * @author Codex
 * @description Runs only private fd/rg argv under the existing Job supervisor and validates framed completion.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { BasicToolError } from './basic-inputs';

const pins = {
  rg: '14231169855ec5205cf5a1b6f1db358ff4aed4247c86b69ce8aae647c77f6680',
  fd: 'd67d27a8e375ed7e9bca2b506a9dd5082bc24547aeba908b863f6f8b8ab0c3b9',
};
const terminalSchema = z.strictObject({
  started: z.boolean(),
  quiescent: z.literal(true),
  exitCode: z.number().int().nonnegative(),
  reason: z.enum([
    'completed',
    'launch_failed',
    'cancelled',
    'timeout',
    'output_limit',
    'background_process_rejected',
  ]),
});
export type SearchProcessResult = {
  stdout: Buffer;
  stderr: Buffer;
  terminal: z.infer<typeof terminalSchema>;
};

export class SearchProcess {
  /**
   * Accepts only trusted Host resource paths; callers select a finite tool name rather than an executable.
   */
  constructor(
    private readonly supervisor: string,
    private readonly resources: string
  ) {
    if (!isAbsolute(supervisor) || !isAbsolute(resources)) {
      throw new BasicToolError('SEARCH_UNAVAILABLE', 'Search resources must use Host-owned absolute paths.');
    }
  }

  /**
   * Rejects changed or missing assets without PATH lookup, first-launch downloads or fallback.
   */
  async verify(): Promise<void> {
    for (const name of ['fd', 'rg'] as const) {
      if (
        createHash('sha256')
          .update(await readFile(join(this.resources, name, `${name}.exe`)))
          .digest('hex') !== pins[name]
      ) {
        throw new BasicToolError('SEARCH_UNAVAILABLE', 'A pinned search executable is missing or changed.');
      }
    }
  }

  /**
   * Drains bounded frames until the supervisor proves Job quiescence, including timeout and cancellation.
   */
  async run(
    name: 'fd' | 'rg',
    args: readonly string[],
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<SearchProcessResult> {
    if (signal.aborted) {
      throw new BasicToolError('TASK_STOPPED', 'The search was cancelled before dispatch.');
    }
    await this.verify();
    if (signal.aborted || timeoutMs <= 0) {
      throw new BasicToolError('SEARCH_CANCELLED', 'The search budget expired or was cancelled.');
    }
    return new Promise((accept, reject) => {
      const child = spawn(
        this.supervisor,
        [
          join(this.resources, name, `${name}.exe`),
          cwd,
          '--search',
          String(Math.min(30000, timeoutMs)),
          String(process.pid),
          ...args,
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
          env: {
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.SystemRoot,
            PATH: join(process.env.SystemRoot!, 'System32'),
            HOME: cwd,
            USERPROFILE: cwd,
            LANG: 'C.UTF-8',
            LC_ALL: 'C.UTF-8',
          },
        }
      );
      let buffered = Buffer.alloc(0);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let length = 0;
      let terminal: z.infer<typeof terminalSchema> | undefined;
      let invalid = false;
      /**
       * Requests Job cancellation without declaring the owned process tree stopped.
       */
      const cancel = () => {
        if (!child.stdin.destroyed) {
          child.stdin.write('C');
        }
      };
      signal.addEventListener('abort', cancel, { once: true });
      child.stdin.on('error', () => {});
      const watchdog = setTimeout(() => {
        invalid = true;
        child.kill();
      }, timeoutMs + 10000);
      child.stdout.on('data', (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        while (buffered.length >= 5 && !invalid) {
          const kind = buffered[0];
          const size = buffered.readUInt32LE(1);
          if (size > 16384 || terminal || ![1, 2, 3].includes(kind!)) {
            invalid = true;
            child.kill();
            break;
          }
          if (buffered.length < size + 5) {
            break;
          }
          const bytes = Buffer.from(buffered.subarray(5, size + 5));
          buffered = buffered.subarray(size + 5);
          if (kind === 3) {
            try {
              terminal = terminalSchema.parse(JSON.parse(bytes.toString('utf8')));
            } catch {
              invalid = true;
              child.kill();
            }
          } else {
            length += size;
            if (length > 2 * 1024 * 1024) {
              invalid = true;
              child.kill();
              break;
            }
            (kind === 1 ? stdout : stderr).push(bytes);
          }
        }
      });
      child.once('error', () => {
        invalid = true;
      });
      child.once('close', (code) => {
        clearTimeout(watchdog);
        signal.removeEventListener('abort', cancel);
        if (invalid || code !== 0 || !terminal || buffered.length) {
          reject(
            new BasicToolError('SEARCH_SUPERVISION_LOST', 'Search process cleanup could not be confirmed.')
          );
        } else if (terminal.reason === 'cancelled' || signal.aborted) {
          reject(new BasicToolError('SEARCH_CANCELLED', 'The search was cancelled and its Job drained.'));
        } else if (terminal.reason === 'timeout') {
          reject(
            new BasicToolError('SEARCH_TIMEOUT', 'The search exceeded its finite budget and its Job drained.')
          );
        } else if (!terminal.started || !['completed', 'output_limit'].includes(terminal.reason)) {
          reject(new BasicToolError('SEARCH_PROCESS_FAILED', 'The private search process failed.'));
        } else {
          accept({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), terminal });
        }
      });
      if (signal.aborted) {
        cancel();
      }
    });
  }
}
