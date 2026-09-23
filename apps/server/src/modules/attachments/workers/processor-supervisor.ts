/**
 * @author root
 * @description Supervises one-job Node child processors with IPC V1 validation, watchdogs, and parent-side artifact verification.
 */
import { ArtifactManifestV1Schema, ProcessorMessageV1Schema } from '@octopus/shared/protocol/attachments';
import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ATTACHMENT_PROCESSOR } from '../attachments.utils.js';
import type {
  ArtifactManifestV1,
  ProcessorLimitsV1,
  ProcessorMessageV1,
  ProcessorStartV1,
} from '@octopus/shared/protocol/attachments';

const MAX_IPC_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const CHILD_ENTRY = resolveProcessorChildEntry(import.meta.url);

/**
 * Keeps the supervised child executable in both tsx development and compiled production runtimes.
 */
export function resolveProcessorChildEntry(moduleUrl: string): string {
  return fileURLToPath(
    new URL(moduleUrl.endsWith('.ts') ? './processor-child.ts' : './processor-child.js', moduleUrl)
  );
}

/**
 * Resolves the development-only TypeScript loader relative to the Server module rather than the
 * constrained attachment working directory inherited by the child process.
 *
 * @param moduleUrl Parent Server module URL that owns the tsx dependency.
 * @returns Absolute file URL accepted by Node's --import flag.
 */
export function resolveTsxImportSpecifier(moduleUrl: string): string {
  return pathToFileURL(createRequire(moduleUrl).resolve('tsx')).href;
}

export interface VerifiedProcessorResult {
  manifest: ArtifactManifestV1;
  outputKeys: Map<string, string>;
}

/**
 * Owns child lifecycle without giving the child database, Workspace, network, or secret configuration.
 */
export class ProcessorSupervisor {
  /**
   *
   * @param dataRoot Attachment data root used as the child's constrained cwd.
   * @param childEntry Fixed one-job processor entry; replaceable only for deterministic crash tests.
   */
  public constructor(
    private readonly dataRoot: string,
    private readonly childEntry: string = CHILD_ENTRY
  ) {}

  /**
   * Runs and validates exactly one task, terminating on timeout, heartbeat loss, RSS, protocol, or output violations.
   */
  public async run(input: {
    jobId: string;
    attachmentId: string;
    sourceKey: string;
    sha256: string;
    detectedMediaType: string;
    limits: ProcessorLimitsV1;
  }): Promise<VerifiedProcessorResult> {
    if (!/^[a-f0-9-]{36}$/iu.test(input.jobId)) {
      throw processorError('PROCESSOR_PROTOCOL_VIOLATION', false);
    }
    const outputKey = `staging/jobs/${input.jobId}/${randomUUID()}`;
    const outputDirectory = resolve(this.dataRoot, outputKey);
    await mkdir(outputDirectory, { recursive: true });
    const scratchDirectory = resolve(outputDirectory, 'scratch');
    await mkdir(scratchDirectory, { recursive: true });
    const start: ProcessorStartV1 = {
      protocol: 1,
      type: 'start',
      jobId: input.jobId,
      attachmentId: input.attachmentId,
      processor: ATTACHMENT_PROCESSOR,
      input: {
        relativePath: input.sourceKey,
        sha256: input.sha256,
        detectedMediaType: input.detectedMediaType,
      },
      outputDirectory: outputKey,
      limits: input.limits,
    };
    try {
      const manifest = await this.#execute(start);
      const outputKeys = await verifyOutputs(this.dataRoot, outputKey, manifest, input.limits);
      return { manifest, outputKeys };
    } catch (error) {
      await rm(outputDirectory, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  }

  /**
   * Starts one child and resolves only after one valid terminal result.
   */
  async #execute(start: ProcessorStartV1): Promise<ArtifactManifestV1> {
    return new Promise((resolveResult, rejectResult) => {
      const child = fork(this.childEntry, [], {
        cwd: this.dataRoot,
        env: { NODE_ENV: 'production' },
        execArgv: [
          ...(this.childEntry.endsWith('.ts')
            ? ['--import', resolveTsxImportSpecifier(import.meta.url)]
            : []),
          '--max-old-space-size=768',
        ],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      let settled = false;
      let finishing = false;
      let lastHeartbeat = Date.now();
      let heartbeatSeen = false;
      let terminalSeen = false;
      let stderrBytes = 0;
      const stderrChunks: Buffer[] = [];
      const finish = (error?: Error, manifest?: ArtifactManifestV1): void => {
        if (settled || finishing) {
          return;
        }
        finishing = true;
        clearInterval(watchdog);
        clearTimeout(timeout);
        if (child.connected) {
          child.disconnect();
        }
        const settleAfterExit = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          child.removeAllListeners();
          setTimeout(() => {
            if (error !== undefined) {
              rejectResult(error);
            } else if (manifest !== undefined) {
              resolveResult(manifest);
            } else {
              rejectResult(processorError('PROCESSOR_CRASHED', true));
            }
          }, 25);
        };
        child.once('exit', settleAfterExit);
        child.once('close', settleAfterExit);
        if (child.exitCode !== null || child.signalCode !== null) {
          setImmediate(settleAfterExit);
        }
        if (!child.killed) {
          child.kill();
        }
      };
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > MAX_STDERR_BYTES) {
          finish(
            processorError(
              'PROCESSOR_PROTOCOL_VIOLATION',
              false,
              'Attachment processor stderr exceeded the diagnostic limit.'
            )
          );
          return;
        }
        stderrChunks.push(chunk);
      });
      child.on('error', () => finish(processorError('PROCESSOR_START_FAILED', true)));
      child.on('exit', (exitCode, signal) => {
        if (!settled) {
          finish(
            processorError(
              'PROCESSOR_CRASHED',
              true,
              describeProcessorCrash(Buffer.concat(stderrChunks).toString('utf8'), exitCode, signal)
            )
          );
        }
      });
      child.on('message', (raw: unknown) => {
        if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_IPC_BYTES) {
          return finish(processorError('PROCESSOR_PROTOCOL_VIOLATION', false));
        }
        const parsed = ProcessorMessageV1Schema.safeParse(raw);
        if (!parsed.success || parsed.data.jobId !== start.jobId) {
          return finish(processorError('PROCESSOR_PROTOCOL_VIOLATION', false));
        }
        const message: ProcessorMessageV1 = parsed.data;
        if (message.type === 'heartbeat') {
          heartbeatSeen = true;
          lastHeartbeat = Date.now();
          if (message.rssBytes > start.limits.maxRssBytes) {
            finish(
              processorError(
                'PROCESSOR_RESOURCE_LIMIT_EXCEEDED',
                false,
                `Attachment processor RSS ${String(message.rssBytes)} exceeded limit ${String(start.limits.maxRssBytes)}.`
              )
            );
          }
        } else if (message.type === 'result' || message.type === 'error') {
          if (terminalSeen) {
            return finish(processorError('PROCESSOR_PROTOCOL_VIOLATION', false));
          }
          terminalSeen = true;
          if (message.type === 'error') {
            finish(processorError(message.code, message.retryable, message.message));
          } else {
            finish(undefined, ArtifactManifestV1Schema.parse(message.manifest));
          }
        }
      });
      const watchdog = setInterval(() => {
        const tolerance = heartbeatSeen ? 5_000 : 15_000;
        if (Date.now() - lastHeartbeat > tolerance) {
          finish(processorError('PROCESSOR_HEARTBEAT_LOST', true));
        }
      }, 1_000);
      const timeout = setTimeout(
        () => finish(processorError('PROCESSOR_TIMEOUT', false)),
        start.limits.wallTimeMs
      );
      child.send(start, (error) => {
        if (error !== null) {
          finish(processorError('PROCESSOR_START_FAILED', true));
        }
      });
    });
  }
}

/**
 * Converts an untrusted child exit into a bounded internal diagnostic without copying arbitrary stderr into logs.
 */
function describeProcessorCrash(
  stderr: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null
): string {
  const exit = exitCode === null ? 'none' : String(exitCode);
  const terminationSignal = signal ?? 'none';
  if (/JavaScript heap out of memory|Ineffective mark-compacts near heap limit/iu.test(stderr)) {
    return `Attachment processor exhausted its JavaScript heap (exit code ${exit}, signal ${terminationSignal}).`;
  }
  return `Attachment processor exited before returning a result (exit code ${exit}, signal ${terminationSignal}).`;
}

/**
 * Rechecks every child declaration against ordinary files, hashes, size, count, and total output.
 */
async function verifyOutputs(
  root: string,
  outputKey: string,
  manifest: ArtifactManifestV1,
  limits: ProcessorLimitsV1
): Promise<Map<string, string>> {
  if (manifest.outputs.length > limits.maxOutputFiles) {
    throw processorError('PROCESSOR_RESOURCE_LIMIT_EXCEEDED', false);
  }
  const result = new Map<string, string>();
  let total = 0;
  for (const output of manifest.outputs) {
    if (
      output.relativePath.includes('..') ||
      output.relativePath.includes('/') ||
      output.relativePath.includes('\\')
    ) {
      throw processorError('PROCESSOR_PROTOCOL_VIOLATION', false);
    }
    const key = `${outputKey}/${output.relativePath}`;
    const path = resolve(root, key);
    const child = relative(resolve(root, outputKey), path);
    if (child.startsWith('..')) {
      throw processorError('PROCESSOR_PROTOCOL_VIOLATION', false);
    }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== output.byteSize) {
      throw processorError('PROCESSOR_OUTPUT_INVALID', false);
    }
    total += info.size;
    if (total > limits.maxOutputBytes) {
      throw processorError('PROCESSOR_RESOURCE_LIMIT_EXCEEDED', false);
    }
    if ((await hashFile(path)) !== output.sha256) {
      throw processorError('PROCESSOR_OUTPUT_INVALID', false);
    }
    result.set(output.localId, key);
  }
  return result;
}
/**
 * Streams a file into a parent-trusted SHA-256 digest.
 */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}
/**
 * Creates a stable supervisor failure without child stack or path details.
 */
function processorError(
  code: string,
  retryable: boolean,
  message = 'Attachment processor did not complete safely.'
): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable });
}
