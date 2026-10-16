/**
 * @author Codex
 * @description Owns fixed offline Node/npm resources and verifies their compiled inventory before shell admission.
 */
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { NativeFileCommit } from './native-file-commit';

const fileSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(1024)
    .refine(
      (path) =>
        !/[\\:]/.test(path) &&
        [...path].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
        !path.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
    ),
  size: z
    .number()
    .int()
    .min(0)
    .max(128 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const nodeInventorySchema = z.strictObject({
  version: z.literal(1),
  nodeVersion: z.literal('24.20.0'),
  npmVersion: z.literal('11.19.0'),
  files: z
    .array(fileSchema)
    .min(10)
    .max(5000)
    .refine(
      (files) =>
        new Set(files.map((file) => file.path.toLowerCase())).size === files.length &&
        files.reduce((size, file) => size + file.size, 0) <= 256 * 1024 * 1024
    ),
});
type NodeFile = z.infer<typeof fileSchema>;

/**
 * Stops new readonly checks after the Host cancellation or component deadline without exposing the abort reason.
 */
function checkStartup(signal: AbortSignal): void {
  if (signal.aborted) {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
    throw new Error(timedOut ? 'NODE_RESOURCE_TIMEOUT' : 'NODE_RESOURCE_CANCELLED');
  }
}

export class NodeResources {
  readonly directory: string;

  /**
   * Keeps only a verified inventory and Host-selected absolute directory.
   */
  private constructor(
    private readonly native: NativeFileCommit,
    root: string,
    private readonly files: NodeFile[]
  ) {
    this.directory = join(root, 'resources/node');
  }

  /**
   * Checks the compiled digest, ordinary directory contents and all file bytes with four drained workers.
   */
  static async open(
    root: string,
    native: NativeFileCommit,
    expectedHash: string,
    signal: AbortSignal = AbortSignal.timeout(30000)
  ): Promise<NodeResources> {
    checkStartup(signal);
    if (!isAbsolute(root) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new Error('NODE_TRUST_ANCHOR_MISSING');
    }
    const snapshot = await native.readSnapshot(join(root, 'node-resources.json'));
    checkStartup(signal);
    if (
      !snapshot.ok ||
      snapshot.directory ||
      snapshot.links !== 1 ||
      snapshot.bytes.length > 1024 * 1024 ||
      createHash('sha256').update(snapshot.bytes).digest('hex') !== expectedHash
    ) {
      throw new Error('NODE_INVENTORY_MISMATCH');
    }
    const inventory = nodeInventorySchema.parse(JSON.parse(snapshot.bytes.toString('utf8')));
    for (const path of [
      'node.exe',
      'npm',
      'npm.cmd',
      'npx',
      'npx.cmd',
      'node_modules/npm/bin/npm-cli.js',
      'node_modules/npm/bin/npx-cli.js',
    ]) {
      if (!inventory.files.some((file) => file.path === path)) {
        throw new Error('NODE_ENTRY_MISSING');
      }
    }
    const owner = new NodeResources(native, root, inventory.files);
    const directories = new Set(['']);
    for (const file of inventory.files) {
      const parts = file.path.split('/');
      parts.pop();
      while (parts.length) {
        directories.add(parts.join('/'));
        parts.pop();
      }
    }
    await owner.verifyDirectories(directories, signal);
    let next = 0;
    let failure: unknown;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        while (!failure && next < inventory.files.length) {
          const file = inventory.files[next++]!;
          try {
            checkStartup(signal);
            await owner.verifyFile(file);
            checkStartup(signal);
          } catch (error) {
            failure = error;
            throw error;
          }
        }
      })
    );
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      throw rejected.reason;
    }
    checkStartup(signal);
    return owner;
  }

  /**
   * Checks four ordinary directories at a time and drains the phase before any file worker starts.
   */
  private async verifyDirectories(directories: Set<string>, signal: AbortSignal): Promise<void> {
    const paths = new Set(this.files.map((file) => file.path));
    const pending = [...directories];
    let next = 0;
    let failure: unknown;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        while (!failure && next < pending.length) {
          const directory = pending[next++]!;
          try {
            checkStartup(signal);
            const listing = await this.native.list(join(this.directory, directory));
            checkStartup(signal);
            if (!listing.ok || !listing.directory || listing.entries.length > 10000) {
              throw new Error('NODE_DIRECTORY_INVALID');
            }
            for (const entry of listing.entries) {
              const path = directory ? directory + '/' + entry.name : entry.name;
              if (
                entry.attributes & 0x400 ||
                (entry.attributes & 0x10 ? !directories.has(path) : !paths.has(path))
              ) {
                throw new Error('NODE_UNEXPECTED_RESOURCE');
              }
            }
          } catch (error) {
            failure = error;
            throw error;
          }
        }
      })
    );
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      throw rejected.reason;
    }
  }

  /**
   * Rechecks launch entries per command; full dependency verification belongs to open, not every command.
   * Neither phase guarantees an atomic installation tree against arbitrary same-user shell modification.
   */
  async verifyEntries(): Promise<void> {
    for (const path of [
      'node.exe',
      'npm',
      'npm.cmd',
      'npx',
      'npx.cmd',
      'node_modules/npm/bin/npm-cli.js',
      'node_modules/npm/bin/npx-cli.js',
    ]) {
      await this.verifyFile(this.files.find((file) => file.path === path)!);
    }
  }

  /**
   * Uses pinned native digests for small files; the 89 MiB executable uses a bounded stream and before/after native identity checks.
   */
  private async verifyFile(file: NodeFile): Promise<void> {
    const path = join(this.directory, file.path);
    if (file.size <= 64 * 1024 * 1024) {
      const result = await this.native.readDigest(path, file.size);
      if (
        !result.ok ||
        result.directory ||
        result.links !== 1 ||
        result.size !== file.size ||
        result.digest !== file.sha256
      ) {
        throw new Error('NODE_RESOURCE_MISMATCH');
      }
      return;
    }
    const before = await this.native.inspect(path);
    if (!before.ok || before.directory || before.links !== 1 || before.size !== file.size) {
      throw new Error('NODE_RESOURCE_MISMATCH');
    }
    const handle = await open(path, 'r');
    try {
      const initial = await handle.stat();
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(256 * 1024);
      let offset = 0;
      while (offset < file.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, file.size - offset),
          offset
        );
        if (!bytesRead) {
          throw new Error('NODE_RESOURCE_MISMATCH');
        }
        offset += bytesRead;
        hash.update(buffer.subarray(0, bytesRead));
      }
      const final = await handle.stat();
      const after = await this.native.inspect(path);
      if (
        !after.ok ||
        after.directory ||
        after.links !== 1 ||
        after.identity !== before.identity ||
        after.size !== file.size ||
        initial.size !== file.size ||
        initial.mtimeMs !== final.mtimeMs ||
        initial.ctimeMs !== final.ctimeMs ||
        hash.digest('hex') !== file.sha256
      ) {
        throw new Error('NODE_RESOURCE_MISMATCH');
      }
    } finally {
      await handle.close();
    }
  }
}
