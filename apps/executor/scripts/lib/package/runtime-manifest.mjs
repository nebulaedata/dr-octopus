/**
 * @author Codex
 * @description Builds and checks a bounded release inventory for offline acceptance; disk hashes provide corruption evidence, not publisher authentication or atomic installation protection.
 */
import { createHash } from 'node:crypto';
import { open, lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
export const runtimeManifestPath = 'runtime-manifest.json';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const relativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !/[\\:]/.test(value) &&
      [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
      !value.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  );
const version = z.string().min(1).max(256);
const fileSchema = z.strictObject({
  path: relativePath,
  size: z
    .number()
    .int()
    .min(0)
    .max(512 * 1024 * 1024),
  sha256: digest,
});
export const releaseMetadataSchema = z.strictObject({
  product: z.strictObject({
    name: z.literal('Dr.Octopus Executor'),
    version: version.regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
  }),
  platform: z.literal('win32'),
  arch: z.literal('x64'),
  components: z.strictObject({
    electron: z.strictObject({ version, node: version, moduleAbi: version }),
    privateNode: version,
    npm: z.literal('11.19.0').optional(),
    privatePython: version,
    systemShell: z.strictObject({
      kind: z.literal('powershell'),
      versionFamily: z.literal('5.1'),
      source: z.literal('operating-system'),
    }),
    fd: version,
    rg: version,
    pageController: z.literal('1.12.4'),
    windowsMcp: z.strictObject({ version, commit: z.string().regex(/^[a-f0-9]{40}$/) }),
  }),
  entries: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), relativePath),
  schemas: z
    .array(z.strictObject({ path: relativePath, sha256: digest }))
    .min(1)
    .max(16),
  licenses: z.array(relativePath).min(1).max(10000),
  basicBuildId: digest,
  tools: z.strictObject({
    basic: z.array(z.string()).length(7),
    browser: z.array(z.string()).length(11),
    control: z.array(z.string()).length(5),
    computer: z.array(z.string()).length(9),
  }),
  availability: z.strictObject({
    computerEnabled: z.literal(true),
    browserRequiresConnectionAndGrant: z.literal(true),
    shellNode: z.boolean(),
    npmBundled: z.boolean(),
  }),
});
const payloadSchema = releaseMetadataSchema
  .extend({
    schemaVersion: z.literal(1),
    files: z.array(fileSchema).min(1).max(30000),
  })
  .superRefine((value, context) => {
    const paths = new Set(value.files.map((file) => file.path.toLowerCase()));
    const expected = [
      ...Object.values(value.entries),
      ...value.schemas.map((item) => item.path),
      ...value.licenses,
    ];
    if (
      paths.size !== value.files.length ||
      value.availability.shellNode !== value.availability.npmBundled ||
      (value.availability.npmBundled &&
        (!value.components.npm ||
          !value.entries.node ||
          !value.entries.npm ||
          !value.entries.npx ||
          !value.entries.nodeInventory)) ||
      (!value.availability.npmBundled && value.components.npm !== undefined) ||
      paths.has(runtimeManifestPath) ||
      value.files.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 ** 3 ||
      expected.some((path) => !value.files.some((file) => file.path === path)) ||
      value.schemas.some(
        (schema) => !value.files.some((file) => file.path === schema.path && file.sha256 === schema.sha256)
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid release inventory references or bounds.' });
    }
  });
export const runtimeManifestSchema = payloadSchema.safeExtend({ productBuildId: digest });
/**
 * Reads only bounded ordinary files and rejects a change detected during hashing; this is not an atomic filesystem snapshot.
 */
async function hashFile(path, budget) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 512 * 1024 * 1024) {
    throw new Error('RELEASE_FILE_INVALID');
  }
  budget.remaining -= before.size;
  if (budget.remaining < 0) {
    throw new Error('RELEASE_INVENTORY_LIMIT');
  }
  const file = await open(path, 'r');
  try {
    const opened = await file.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error('RELEASE_FILE_CHANGED');
    }
    const hash = createHash('sha256');
    const bytes = Buffer.allocUnsafe(256 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await file.read(bytes);
      if (!bytesRead) {
        break;
      }
      total += bytesRead;
      if (total > before.size) {
        throw new Error('RELEASE_FILE_CHANGED');
      }
      hash.update(bytes.subarray(0, bytesRead));
    }
    const after = await file.stat();
    const current = await lstat(path);
    if (
      total !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      current.isSymbolicLink() ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.size !== before.size ||
      current.mtimeMs !== before.mtimeMs ||
      current.ctimeMs !== before.ctimeMs
    ) {
      throw new Error('RELEASE_FILE_CHANGED');
    }
    return { size: total, sha256: hash.digest('hex') };
  } finally {
    await file.close();
  }
}
/**
 * Enumerates the complete product tree with finite directory/file counts and rejects links, special files and Windows path aliases.
 */
export async function inventoryProduct(root) {
  if ((await realpath(root)).toLowerCase() !== resolve(root).toLowerCase()) {
    throw new Error('RELEASE_ROOT_ALIAS');
  }
  const pending = [''];
  const paths = [];
  let directories = 0;
  while (pending.length) {
    const directory = pending.pop();
    const info = await lstat(join(root, directory));
    if (!info.isDirectory() || info.isSymbolicLink() || ++directories > 15000) {
      throw new Error('RELEASE_DIRECTORY_INVALID');
    }
    for (const item of await readdir(join(root, directory), { withFileTypes: true })) {
      const relative = relativePath.parse(directory ? `${directory}/${item.name}` : item.name);
      if (item.isSymbolicLink()) {
        throw new Error('RELEASE_LINK_REJECTED');
      }
      if (item.isDirectory()) {
        pending.push(relative);
        if (pending.length + directories > 15000) {
          throw new Error('RELEASE_INVENTORY_LIMIT');
        }
      } else if (item.isFile()) {
        if (relative !== runtimeManifestPath) {
          paths.push(relative);
        }
        if (paths.length > 30000) {
          throw new Error('RELEASE_INVENTORY_LIMIT');
        }
      } else {
        throw new Error('RELEASE_FILE_INVALID');
      }
    }
  }
  paths.sort();
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) {
    throw new Error('RELEASE_PATH_ALIAS');
  }
  const files = new Array(paths.length);
  let next = 0;
  let failure;
  const budget = { remaining: 4 * 1024 ** 3 };
  const workers = Array.from({ length: 4 }, async () => {
    while (!failure && next < paths.length) {
      const index = next++;
      const path = paths[index];
      try {
        files[index] = { path, ...(await hashFile(join(root, path), budget)) };
      } catch (error) {
        failure = error;
      }
    }
  });
  await Promise.allSettled(workers);
  if (failure) {
    throw failure;
  }
  return files;
}
/**
 * Canonicalizes object keys so the build identity depends on content rather than JSON property insertion order.
 */
function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
}
/**
 * Anchors metadata and sorted file records to one deterministic release content identifier.
 */
function buildId(payload) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');
}
/**
 * Produces an inventory from the already packaged tree, including Electron files, ASAR, both extensions and license materials.
 */
export async function createRuntimeManifest(root, metadata) {
  const payload = payloadSchema.parse({ ...metadata, schemaVersion: 1, files: await inventoryProduct(root) });
  return runtimeManifestSchema.parse({ ...payload, productBuildId: buildId(payload) });
}
/**
 * Rejects inconsistent metadata, changed/missing/extra files, detected symlinks/junctions and root aliases before reporting offline inventory evidence.
 */
export async function verifyRuntimeManifest(root, input) {
  const manifest = runtimeManifestSchema.parse(input);
  const { productBuildId, ...payload } = manifest;
  if (productBuildId !== buildId(payload)) {
    throw new Error('RELEASE_BUILD_ID_MISMATCH');
  }
  const actual = await inventoryProduct(root);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
    throw new Error('RELEASE_INVENTORY_MISMATCH');
  }
  return { productBuildId, files: actual.length, bytes: actual.reduce((sum, file) => sum + file.size, 0) };
}
