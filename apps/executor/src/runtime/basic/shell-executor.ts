/**
 * @author Codex
 * @description Runs system PowerShell scripts through a Windows Job supervisor and retains sealed owner-bound raw output.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, lstat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, win32 } from 'node:path';
import { z } from 'zod';
import { BasicToolError } from './basic-inputs';
import type { NativeFileCommit } from './native-file-commit';
import { ShellHistory } from './shell-history';
import type { NodeResources } from './node-resources';
import { inspectSystemShell, systemModulePath } from './shell-platform';
import type { SystemShell, ShellStatus } from './shell-platform';

const maxOutput = 64 * 1024 * 1024;
const resultSchema = z.strictObject({
  started: z.boolean(),
  quiescent: z.literal(true),
  exitCode: z.number().int().min(0).max(0xffffffff),
  reason: z.enum([
    'completed',
    'launch_failed',
    'timeout',
    'cancelled',
    'output_limit',
    'background_process_rejected',
  ]),
});
export type ShellResult = {
  output: string;
  exitCode: number;
  durationMs: number;
  effectiveTimeoutMs: number;
  terminationReason: z.infer<typeof resultSchema>['reason'];
  executionState: 'quiescent';
  businessEffect: 'unknown' | 'not_applied';
  truncated: boolean;
  replacementUsed: boolean;
  outputArtifact: { uri: string; stdoutBytes: number; stderrBytes: number; expiresAt: string };
};
export class ShellExecutor {
  private active = 0;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  /**
   * Owns one fixed system interpreter and private result store; callers cannot choose an executable.
   */
  private constructor(
    private readonly supervisor: string,
    private readonly system: SystemShell,
    private readonly native: NativeFileCommit,
    private readonly history: ShellHistory,
    private readonly node: NodeResources
  ) {
    this.cleanupTimer = setInterval(() => {
      this.history.cleanup().catch(() => {
        console.warn('[executor] Shell output cleanup deferred.');
      });
    }, 60000);
    this.cleanupTimer.unref();
  }

  /**
   * Opens persistent ownership and probes the fixed system Shell once, without failing independent tools when it is unavailable.
   */
  static async open(
    supervisor: string,
    data: string,
    native: NativeFileCommit,
    node: NodeResources
  ): Promise<ShellExecutor> {
    if (![supervisor, data].every(isAbsolute)) {
      throw new Error('Shell resources must be absolute.');
    }
    const system = await inspectSystemShell();
    const history = await ShellHistory.open(native, data);
    const shell = new ShellExecutor(supervisor, system, native, history, node);
    try {
      if (!(await lstat(supervisor)).isFile()) {
        throw new Error('Process supervisor is missing.');
      }
      return shell;
    } catch (error) {
      await shell.close();
      throw error;
    }
  }

  /**
   * Exposes only cached interpreter identity and availability, without launching a process during discovery.
   */
  status(): ShellStatus {
    return { ...this.system.status };
  }

  /**
   * Checks task history without granting admission; used by the single Host task authority.
   */
  hasTaskHistory(ownerId: string, taskId: string): boolean {
    return this.history.hasTask(ownerId, taskId);
  }

  /**
   * Retrieves a durable exact-input outcome; incomplete history throws instead of executing again.
   */
  lookup(ownerId: string, taskId: string, key: string, fingerprint: string): ShellResult | undefined {
    return this.history.lookup(ownerId, taskId, key, fingerprint);
  }

  /**
   * Revokes artifacts independently of historical result retrieval.
   */
  async revokeOutput(ownerId: string, taskId: string): Promise<void> {
    await this.history.revoke(ownerId, taskId);
  }

  /**
   * Releases expired output after confirmed completion while preserving replay barriers.
   */
  async cleanup(): Promise<void> {
    await this.history.cleanup();
  }

  /**
   * Releases ledger ownership only after the task authority has drained all commands.
   */
  async close(): Promise<void> {
    if (this.active) {
      throw new BasicToolError('SHELL_BUSY', 'Shell commands must be drained before close.');
    }
    clearInterval(this.cleanupTimer);
    await this.history.close();
  }

  /**
   * Rechecks required entries without re-running the system version probe or trusting PATH for the interpreter.
   */
  async verify(): Promise<void> {
    await this.node.verifyEntries();
    if (!this.system.status.available) {
      throw new BasicToolError(
        'SHELL_UNAVAILABLE',
        this.system.status.code ?? 'System PowerShell is unavailable.'
      );
    }
    for (const path of [this.supervisor, this.system.executable]) {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new BasicToolError('SHELL_UNAVAILABLE', 'The selected Shell or supervisor is unavailable.');
      }
    }
  }

  /**
   * Creates a private native-owned directory with no reuse of an existing path.
   */
  private async privateDirectory(path: string): Promise<void> {
    const result = await this.native.createRecovery(path);
    if (!result.ok || !result.privateAcl) {
      throw new BasicToolError('SHELL_STORAGE_FAILED', 'Private shell storage could not be created.');
    }
  }

  /**
   * Supervises one finite process tree, drains framed raw output and seals files before returning quiescence.
   * Shell authorization is powerful OS-user execution; cwd and environment are not a filesystem sandbox.
   */
  async run(request: {
    ownerId: string;
    taskId: string;
    cwd: string;
    command: string;
    idempotencyKey: string;
    fingerprint: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ShellResult> {
    if (this.active >= 4) {
      throw new BasicToolError(
        'SHELL_OUTPUT_QUOTA',
        'The shell concurrency or retained output quota was reached.'
      );
    }
    if (request.signal.aborted) {
      throw new BasicToolError('TASK_STOPPED', 'The task has stopped.');
    }
    this.active++;
    let id: string | undefined;
    const beginning = Date.now();
    let retained = 0;
    let handles: Awaited<ReturnType<typeof open>>[] = [];
    try {
      await this.verify();
      await this.history.cleanup();
      id = await this.history.admit(request);
      const directory = this.history.directory(id);
      await this.privateDirectory(directory);
      const directoryIdentity = (await this.native.inspect(directory)).identity;
      const home = join(directory, '.octopus-executor-recovery-home');
      await this.privateDirectory(home);
      const script = join(home, 'command.ps1');
      const source =
        '\ufeff[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)\r\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\r\n$OutputEncoding = [Console]::OutputEncoding\r\n' +
        request.command;
      const scriptFile = await this.native.writePrivateConfig(script, source);
      if (!scriptFile.ok || !scriptFile.privateAcl) {
        throw new BasicToolError('SHELL_STORAGE_FAILED', 'Private command script could not be created.');
      }
      handles = await Promise.all(['stdout', 'stderr'].map((name) => open(join(directory, name), 'wx')));
      const identities = (await Promise.all(
        ['stdout', 'stderr'].map(async (name) => (await this.native.inspect(join(directory, name))).identity)
      )) as [string, string];
      const hashes = [createHash('sha256'), createHash('sha256')];
      const lengths: [number, number] = [0, 0];
      const decoders = [new TextDecoder('utf-8'), new TextDecoder('utf-8')];
      const validators = [
        new TextDecoder('utf-8', { fatal: true }),
        new TextDecoder('utf-8', { fatal: true }),
      ];
      let tail = '';
      let truncated = false;
      let replacementUsed = false;
      let buffered = Buffer.alloc(0);
      let terminal: z.infer<typeof resultSchema> | undefined;
      let failure: Error | undefined;
      let writes: Promise<void> = Promise.resolve();
      const windows = process.env.SystemRoot ?? 'C:\\Windows';
      const environment: NodeJS.ProcessEnv = {
        SystemRoot: windows,
        WINDIR: windows,
        PATH: [
          this.node.directory,
          join(windows, 'System32'),
          dirname(this.system.executable),
          ...(process.env.PATH ?? '')
            .split(';')
            .map((entry) => entry.trim())
            .filter(
              (entry) => /^[A-Za-z]:\\/.test(entry) && win32.isAbsolute(entry) && !/[\r\n"\0]/.test(entry)
            ),
        ].join(';'),
        ComSpec: join(windows, 'System32', 'cmd.exe'),
        PSModulePath: systemModulePath(this.system.executable),
        HOME: home,
        USERPROFILE: home,
        TEMP: home,
        TMP: home,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: 'NUL',
        GIT_TERMINAL_PROMPT: '0',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        npm_config_cache: join(home, 'npm-cache'),
        npm_config_prefix: join(home, 'npm-prefix'),
        npm_config_userconfig: join(home, 'npm-user.conf'),
        npm_config_globalconfig: join(home, 'npm-global.conf'),
        npm_config_update_notifier: 'false',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_yes: 'false',
      };
      if (request.signal.aborted) {
        throw new BasicToolError('TASK_STOPPED', 'The task has stopped.');
      }
      await this.history.dispatch(id);
      const child = spawn(
        this.supervisor,
        [
          this.system.executable,
          request.cwd,
          '--powershell',
          String(request.timeoutMs),
          String(process.pid),
          script,
        ],
        {
          shell: false,
          windowsHide: true,
          env: environment,
          stdio: ['pipe', 'pipe', 'ignore'],
        }
      );
      child.stdin.on('error', () => {});
      /**
       * Cancels through the owned control pipe independently from the task's execution queue.
       */
      const abort = (): void => {
        child.stdin.end('C');
      };
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) {
        abort();
      }
      const watchdog = setTimeout(() => {
        failure = new Error('Supervisor deadline exceeded.');
        child.kill();
      }, request.timeoutMs + 10000);
      /**
       * Bounds decoded tail independently from the raw retained artifact; replacement is explicitly reported.
       */
      const preview = (text: string): void => {
        tail += text;
        const lines = tail.split('\n');
        if (lines.length > 2000) {
          tail = lines.slice(-2000).join('\n');
          truncated = true;
        }
        const encoded = Buffer.from(tail);
        if (encoded.length > 50 * 1024) {
          let start = encoded.length - 50 * 1024;
          while ((encoded[start]! & 0xc0) === 0x80) {
            start++;
          }
          tail = encoded.subarray(start).toString('utf8');
          truncated = true;
        }
      };
      child.stdout.on('data', (chunk: Buffer) => {
        child.stdout.pause();
        writes = writes
          .then(async () => {
            buffered = Buffer.concat([buffered, chunk]);
            while (buffered.length >= 5) {
              const kind = buffered[0]!;
              const length = buffered.readUInt32LE(1);
              if (length > 16384 || kind < 1 || kind > 3 || terminal) {
                throw new Error('Invalid supervisor frame.');
              }
              if (buffered.length < length + 5) {
                break;
              }
              const payload = buffered.subarray(5, 5 + length);
              buffered = buffered.subarray(5 + length);
              if (kind === 3) {
                terminal = resultSchema.parse(JSON.parse(payload.toString('utf8')));
                continue;
              }
              const index = kind - 1;
              try {
                validators[index]!.decode(payload, { stream: true });
              } catch {
                replacementUsed = true;
              }
              const keep = Math.min(payload.length, maxOutput - retained);
              if (keep) {
                await handles[index]!.writeFile(payload.subarray(0, keep));
                lengths[index] += keep;
                retained += keep;
                hashes[index]!.update(payload.subarray(0, keep));
              }
              preview(decoders[index]!.decode(payload, { stream: true }));
              if (keep < payload.length) {
                truncated = true;
                child.stdin.end('L');
              }
            }
          })
          .catch((error: unknown) => {
            failure = error instanceof Error ? error : new Error('Output failure.');
            child.kill();
          })
          .finally(() => child.stdout.resume());
      });
      let code: number | null;
      try {
        code = await new Promise<number | null>((accept, reject) => {
          child.once('error', reject);
          child.once('close', accept);
        });
        await writes;
      } finally {
        clearTimeout(watchdog);
        request.signal.removeEventListener('abort', abort);
        child.stdin.destroy();
      }
      if (failure || code !== 0 || !terminal || buffered.length) {
        throw new BasicToolError(
          'SHELL_SUPERVISION_LOST',
          'Shell completion could not be confirmed; effects may be unknown.'
        );
      }
      decoders.forEach((decoder) => preview(decoder.decode()));
      validators.forEach((decoder) => {
        try {
          decoder.decode();
        } catch {
          replacementUsed = true;
        }
      });
      truncated ||= terminal.reason === 'output_limit';
      const scriptAfter = await this.native.inspect(script);
      if (!scriptAfter.ok || scriptAfter.identity !== scriptFile.identity || scriptAfter.links !== 1) {
        throw new BasicToolError(
          'SHELL_STORAGE_CHANGED',
          'Private script identity changed; evidence was retained.'
        );
      }
      await unlink(script);
      for (const handle of handles) {
        await handle.sync();
        await handle.close();
      }
      handles = [];
      const digests = hashes.map((hash) => hash.digest('hex')) as [string, string];
      for (const [index, name] of ['stdout', 'stderr'].entries()) {
        await this.verifiedPage(
          join(directory, name),
          identities[index]!,
          digests[index]!,
          lengths[index]!,
          0,
          0
        );
      }
      const expires = Date.now() + 24 * 60 * 60 * 1000;
      const result: ShellResult = {
        output: tail,
        exitCode: terminal.exitCode,
        durationMs: Date.now() - beginning,
        effectiveTimeoutMs: request.timeoutMs,
        terminationReason: terminal.reason,
        executionState: 'quiescent',
        businessEffect: terminal.started ? 'unknown' : 'not_applied',
        truncated,
        replacementUsed,
        outputArtifact: {
          uri: `executor-output://${id}`,
          stdoutBytes: lengths[0],
          stderrBytes: lengths[1],
          expiresAt: new Date(expires).toISOString(),
        },
      };
      await this.history.seal(id, { identity: directoryIdentity, lengths, digests, identities }, result);
      return this.history.lookup(
        request.ownerId,
        request.taskId,
        request.idempotencyKey,
        request.fingerprint
      )!;
    } catch (error) {
      if (id) {
        try {
          await this.history.fail(id);
        } catch {
          throw new BasicToolError(
            'SHELL_SUPERVISION_LOST',
            'Shell history persistence failed; do not replay this operation.'
          );
        }
      }
      throw error;
    } finally {
      await Promise.allSettled(handles.map((handle) => handle.close()));
      this.active--;
    }
  }

  /**
   * Reads a sealed artifact only for its owner and source task; expiry revokes access without automatic replay.
   */
  async readOutput(
    ownerId: string,
    taskId: string,
    uri: string,
    stream: 'stdout' | 'stderr',
    offset: number,
    limit: number
  ): Promise<{ bytes: Buffer; totalBytes: number; version: string }> {
    const id = /^executor-output:\/\/([0-9a-f-]{36})$/.exec(uri)?.[1];
    if (!id) {
      throw new BasicToolError('OUTPUT_NOT_FOUND', 'No retained shell output is authorized.');
    }
    const record = this.history.output(ownerId, taskId, id);
    if (
      (stream !== 'stdout' && stream !== 'stderr') ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 * 1024
    ) {
      throw new BasicToolError('INVALID_INPUT', 'Invalid shell output byte page.');
    }
    const index = stream === 'stdout' ? 0 : 1;
    const bytes = await this.verifiedPage(
      join(record.directory, stream),
      record.identities[index],
      record.digests[index],
      record.lengths[index],
      offset,
      limit
    );
    return { bytes, totalBytes: record.lengths[index], version: record.digests[index] };
  }

  /**
   * Checks native path identity and the sealed content hash on every page; same-user shell changes invalidate output.
   */
  private async verifiedPage(
    path: string,
    identity: string,
    digest: string,
    size: number,
    offset: number,
    limit: number
  ): Promise<Buffer> {
    const before = await this.native.inspect(path);
    if (
      !before.ok ||
      before.identity !== identity ||
      before.links !== 1 ||
      before.directory ||
      before.size !== size
    ) {
      throw new BasicToolError('OUTPUT_CHANGED', 'The sealed shell output has changed.');
    }
    const handle = await open(path, 'r');
    try {
      const hash = createHash('sha256');
      const chunk = Buffer.alloc(65536);
      const page = Buffer.alloc(Math.min(limit, Math.max(0, size - offset)));
      let position = 0;
      while (position < size) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, size - position), position);
        if (!bytesRead) {
          throw new BasicToolError('OUTPUT_CHANGED', 'The sealed shell output was truncated.');
        }
        hash.update(chunk.subarray(0, bytesRead));
        const start = Math.max(position, offset);
        const end = Math.min(position + bytesRead, offset + page.length);
        if (end > start) {
          chunk.copy(page, start - offset, start - position, end - position);
        }
        position += bytesRead;
      }
      const after = await this.native.inspect(path);
      if (!after.ok || after.identity !== identity || after.size !== size || hash.digest('hex') !== digest) {
        throw new BasicToolError('OUTPUT_CHANGED', 'The sealed shell output no longer matches its version.');
      }
      return page;
    } finally {
      await handle.close();
    }
  }
}
