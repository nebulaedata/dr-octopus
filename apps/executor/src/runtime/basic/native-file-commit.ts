/**
 * @author Codex
 * @description Loads the Host-selected native file backend and validates every asynchronous result without fallback.
 */
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { BasicToolError } from './basic-inputs';

const resultSchema = z.strictObject({
  ok: z.boolean(),
  started: z.boolean(),
  nativeCode: z.number().int().nonnegative(),
  identity: z.string().max(128),
  links: z.number().int().nonnegative(),
  size: z.number().nonnegative(),
  directory: z.boolean(),
  privateAcl: z.boolean(),
});
export type NativeFileResult = z.infer<typeof resultSchema>;

type NativeBackend = {
  /**
   * Copies a pinned ordinary source into a new private disk snapshot, bounded to 2 GiB.
   */
  transferSnapshot: (source: string, destination: string, size: number) => Promise<unknown>;
  /**
   * Hashes a pinned transfer file without materializing its content in JavaScript.
   */
  transferDigest: (path: string, size: number) => Promise<unknown>;
  /**
   * Returns only this process token's authentication LUID and Windows session.
   */
  loginIdentity: () => string;
  /**
   * Creates a new bounded UTF-8 configuration with a protected current-user DACL before any content write.
   */
  writePrivateConfig: (path: string, content: string) => Promise<unknown>;
  /**
   * Reads at most 16 MiB while pinning ordinary ancestors and denying write/delete sharing.
   */
  readSnapshot: (path: string) => Promise<unknown>;
  /**
   * Hashes exactly the declared bounded file length while ordinary ancestors and the file deny write/delete sharing.
   */
  readDigest: (path: string, expectedSize: number) => Promise<unknown>;
  /**
   * Lists at most 10001 direct children under a pinned ordinary directory.
   */
  list: (path: string) => Promise<unknown>;
  /**
   * Inspects an ordinary NTFS path off the JavaScript thread.
   */
  inspect: (path: string) => Promise<unknown>;
  /**
   * Creates a new protected recovery directory; never adopts an existing path.
   */
  createRecovery: (path: string) => Promise<unknown>;
  /**
   * Publishes using identities rechecked at the native boundary; started failures may have effects.
   */
  commit: (
    target: string,
    temp: string,
    backup: string,
    targetIdentity: string,
    parentIdentity: string,
    tempIdentity: string
  ) => Promise<unknown>;
};

const backendSchema = z.object({
  transferSnapshot: z.custom<NativeBackend['transferSnapshot']>((value) => typeof value === 'function'),
  transferDigest: z.custom<NativeBackend['transferDigest']>((value) => typeof value === 'function'),
  loginIdentity: z.custom<NativeBackend['loginIdentity']>((value) => typeof value === 'function'),
  writePrivateConfig: z.custom<NativeBackend['writePrivateConfig']>((value) => typeof value === 'function'),
  readSnapshot: z.custom<NativeBackend['readSnapshot']>((value) => typeof value === 'function'),
  readDigest: z.custom<NativeBackend['readDigest']>((value) => typeof value === 'function'),
  list: z.custom<NativeBackend['list']>((value) => typeof value === 'function'),
  inspect: z.custom<NativeBackend['inspect']>((value) => typeof value === 'function'),
  createRecovery: z.custom<NativeBackend['createRecovery']>((value) => typeof value === 'function'),
  commit: z.custom<NativeBackend['commit']>((value) => typeof value === 'function'),
});

export class NativeFileCommit {
  /**
   * Creates a stable binary snapshot; cancellation must drain this native operation before cleanup.
   */
  async transferSnapshot(source: string, destination: string, size: number) {
    z.number()
      .int()
      .min(0)
      .max(2 * 1024 ** 3)
      .parse(size);
    return resultSchema
      .extend({ digest: z.string().max(64) })
      .parse(await this.backend.transferSnapshot(source, destination, size));
  }

  /**
   * Verifies binary transfer material through a pinned native handle, up to 2 GiB.
   */
  async transferDigest(path: string, size: number) {
    z.number()
      .int()
      .min(0)
      .max(2 * 1024 ** 3)
      .parse(size);
    return resultSchema
      .extend({ digest: z.string().max(64) })
      .parse(await this.backend.transferDigest(path, size));
  }
  /**
   * Identifies the current logon through the fixed native backend, without trusting environment variables.
   */
  loginIdentity(): string {
    return z
      .string()
      .regex(/^-?\d+:\d+:\d+$/)
      .parse(this.backend.loginIdentity());
  }
  private readonly backend: NativeBackend;

  /**
   * Loads only an absolute path supplied by trusted Host resource assembly; no renderer/tool path is accepted.
   */
  constructor(binaryPath: string) {
    if (!isAbsolute(binaryPath)) {
      throw new BasicToolError('NATIVE_BACKEND_UNAVAILABLE', 'The native backend path must be absolute.');
    }
    try {
      const loaded: unknown = createRequire(binaryPath)(binaryPath);
      this.backend = backendSchema.parse(loaded);
    } catch {
      throw new BasicToolError('NATIVE_BACKEND_UNAVAILABLE', 'The native file backend could not be loaded.');
    }
  }

  /**
   * Returns a checked finite result; callers must handle missing/unsupported files explicitly.
   */
  async inspect(path: string): Promise<NativeFileResult> {
    return this.parse(await this.backend.inspect(path));
  }

  /**
   * Writes Host-selected private configuration without replacing existing paths or following reparses.
   */
  async writePrivateConfig(path: string, content: string): Promise<NativeFileResult> {
    if (
      !content.isWellFormed() ||
      content.includes('\0') ||
      content.length > 30000 ||
      Buffer.byteLength(content) > 65536
    ) {
      throw new BasicToolError(
        'INVALID_CONFIG',
        'The connection configuration exceeds its supported limits.'
      );
    }
    return this.parse(await this.backend.writePrivateConfig(path, content));
  }

  /**
   * Returns bounded bytes with the same native path enforcement as publication.
   */
  async readSnapshot(path: string) {
    return resultSchema
      .extend({ bytes: z.instanceof(Buffer).refine((bytes) => bytes.length <= 16 * 1024 * 1024) })
      .parse(await this.backend.readSnapshot(path));
  }

  /**
   * Returns only identity, metadata and SHA-256 from one pinned native operation, without copying file content to JavaScript.
   */
  async readDigest(path: string, expectedSize: number) {
    z.number()
      .int()
      .min(0)
      .max(64 * 1024 * 1024)
      .parse(expectedSize);
    return resultSchema
      .extend({ digest: z.string().max(64) })
      .refine((result) => !result.ok || /^[a-f0-9]{64}$/.test(result.digest))
      .parse(await this.backend.readDigest(path, expectedSize));
  }

  /**
   * Returns child metadata without following reparse entries.
   */
  async list(path: string) {
    return resultSchema
      .extend({
        entries: z
          .array(
            z.strictObject({
              name: z.string().max(260),
              attributes: z.number().int().nonnegative(),
              size: z.number().nonnegative(),
            })
          )
          .max(10001),
      })
      .parse(await this.backend.list(path));
  }

  /**
   * Creates protected same-volume material storage, refusing an existing directory.
   */
  async createRecovery(path: string): Promise<NativeFileResult> {
    return this.parse(await this.backend.createRecovery(path));
  }

  /**
   * Enters a publication primitive only after rechecking target, parent and temporary file identities.
   * A false result with started=true is never translated into an unchanged-file guarantee.
   */
  async commit(input: {
    target: string;
    temp: string;
    backup: string;
    targetIdentity: string;
    parentIdentity: string;
    tempIdentity: string;
  }): Promise<NativeFileResult> {
    return this.parse(
      await this.backend.commit(
        input.target,
        input.temp,
        input.backup,
        input.targetIdentity,
        input.parentIdentity,
        input.tempIdentity
      )
    );
  }

  /**
   * Rejects malformed backend messages rather than allowing unvalidated state into the journal.
   */
  private parse(value: unknown): NativeFileResult {
    const result = resultSchema.safeParse(value);
    if (!result.success || (result.data.ok && result.data.identity.length === 0)) {
      throw new BasicToolError(
        'NATIVE_RESULT_INVALID',
        'The native file backend returned an invalid result.'
      );
    }
    return result.data;
  }
}
