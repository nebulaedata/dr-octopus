/**
 * @author Codex
 * @description Copies explicitly stopped Executor data into a new SID-private backup or restore directory, verifying bounded inventories without overwriting originals.
 */
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { NativeFileCommit } from '../runtime/basic/native-file-commit';
import { executorProduct } from '../contracts/product';

const pathSchema = z
  .string()
  .min(1)
  .max(30000)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !value.includes('\\') &&
      !value.includes(':') &&
      !value.includes('\0') &&
      value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  product: z.literal('Dr.Octopus Executor'),
  productVersion: z.literal(executorProduct.version),
  directories: z.array(pathSchema).max(10000),
  files: z
    .array(
      z.strictObject({
        path: pathSchema,
        size: z
          .number()
          .int()
          .min(0)
          .max(1024 ** 3),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
    )
    .max(100000),
});
type Inventory = Pick<z.infer<typeof manifestSchema>, 'directories' | 'files'>;

/**
 * Rejects reparses on every existing ancestor, including a selected root or future output parent.
 */
async function ordinary(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error('DATA_PATH_REPARSE_REJECTED');
  }
  const parent = resolve(path, '..');
  if (parent !== path) {
    await ordinary(parent);
  }
}

/**
 * Streams file content only into its digest, never into a log or metadata field.
 */
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) {
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/**
 * Records ordinary files and empty directories under explicit file/byte limits; the caller must keep the app stopped.
 */
async function inventory(native: NativeFileCommit, root: string, entries?: string[]): Promise<Inventory> {
  await ordinary(root);
  if (!(await native.inspect(root)).ok) {
    throw new Error('DATA_PATH_REPARSE_REJECTED');
  }
  if (!(await lstat(root)).isDirectory()) {
    throw new Error('DATA_DIRECTORY_REQUIRED');
  }
  const result: Inventory = { directories: [], files: [] };
  let bytes = 0;
  /**
   * Traverses only owned inventory paths and refuses links or unsupported filesystem entries.
   */
  async function visit(prefix: string): Promise<void> {
    const names = (await readdir(join(root, prefix))).sort();
    for (const name of names.filter((name) => prefix || !entries || entries.includes(name))) {
      const path = prefix ? prefix + '/' + name : name;
      pathSchema.parse(path);
      const target = join(root, path);
      const info = await lstat(target);
      if (info.isSymbolicLink() || !(await native.inspect(target)).ok) {
        throw new Error('DATA_PATH_REPARSE_REJECTED');
      }
      if (info.isDirectory()) {
        result.directories.push(path);
        if (result.directories.length > 10000) {
          throw new Error('DATA_INVENTORY_LIMIT');
        }
        await visit(path);
      } else if (info.isFile()) {
        bytes += info.size;
        if (info.size > 1024 ** 3 || bytes > 4 * 1024 ** 3 || result.files.length >= 100000) {
          throw new Error('DATA_INVENTORY_LIMIT');
        }
        result.files.push({ path, size: info.size, sha256: await digest(target) });
      } else {
        throw new Error('DATA_ENTRY_REJECTED');
      }
    }
  }
  await visit('');
  return result;
}

/**
 * Refuses existing output, nested source/output paths and non-private output creation before copying any secrets.
 */
async function destination(
  native: NativeFileCommit,
  source: string,
  output: string,
  entries?: string[]
): Promise<void> {
  const sources = entries ? entries.map((entry) => join(source, entry)) : [source];
  for (const [root, target] of sources.flatMap((path) => [
    [path, output],
    [output, path],
  ])) {
    const path = relative(root, target);
    if (!path || (!path.startsWith('..\\') && path !== '..' && !isAbsolute(path))) {
      throw new Error('DATA_PATH_OVERLAP');
    }
  }
  await ordinary(resolve(output, '..'));
  if (!basename(output).startsWith('.octopus-executor-recovery-')) {
    throw new Error('DATA_OUTPUT_NAME_REQUIRED');
  }
  const created = await native.createRecovery(output);
  if (!created.ok || !created.privateAcl) {
    throw new Error('DATA_OUTPUT_CREATE_FAILED');
  }
}

/**
 * Copies into a new private tree and verifies exact output bytes; failures retain partial evidence instead of deleting anything.
 */
async function copy(
  native: NativeFileCommit,
  source: string,
  output: string,
  expected: Inventory
): Promise<void> {
  for (const directory of expected.directories) {
    await mkdir(join(output, directory));
  }
  for (const file of expected.files) {
    await copyFile(join(source, file.path), join(output, file.path), constants.COPYFILE_EXCL);
  }
  // The newly created root already grants only this user. Convert inherited ACEs to protected
  // explicit ACEs so existing journal readers accept copied private records after restoration.
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot)) {
    throw new Error('DATA_ACL_ENVIRONMENT_UNAVAILABLE');
  }
  await promisify(execFile)(join(systemRoot, 'System32/icacls.exe'), [output, '/inheritance:d', '/T', '/Q'], {
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 65536,
  });
  if (JSON.stringify(await inventory(native, output)) !== JSON.stringify(expected)) {
    throw new Error('DATA_COPY_CHANGED');
  }
}

/**
 * Backs up stopped data to a new private directory; optional top-level entries permit scoped in-project backups outside those entries.
 * No application file, registration or existing backup is overwritten.
 */
export async function backupData(
  native: NativeFileCommit,
  source: string,
  output: string,
  entries?: string[]
) {
  source = resolve(source);
  output = resolve(output);
  if (entries) {
    z.array(z.string().regex(/^[a-z][a-z-]*$/))
      .min(1)
      .max(20)
      .parse(entries);
  }
  const expected = await inventory(native, source, entries);
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    product: executorProduct.name,
    productVersion: executorProduct.version,
    ...expected,
  });
  if (Buffer.byteLength(JSON.stringify(manifest)) > 8 * 1024 * 1024) {
    throw new Error('DATA_MANIFEST_LIMIT');
  }
  await destination(native, source, output, entries);
  const payload = join(output, 'data');
  await mkdir(payload);
  await copy(native, source, payload, expected);
  if (JSON.stringify(await inventory(native, source, entries)) !== JSON.stringify(expected)) {
    throw new Error('DATA_SOURCE_CHANGED');
  }
  const file = await open(join(output, 'executor-data-backup.json'), 'wx');
  try {
    await file.writeFile(JSON.stringify(manifest));
  } finally {
    await file.close();
  }
  return { files: expected.files.length, directories: expected.directories.length };
}

/**
 * Restores only this supported backup format to a new empty path; existing data and backups remain untouched.
 */
export async function restoreData(native: NativeFileCommit, backup: string, output: string) {
  backup = resolve(backup);
  output = resolve(output);
  await ordinary(backup);
  const metadata = join(backup, 'executor-data-backup.json');
  await ordinary(metadata);
  if ((await lstat(metadata)).size > 8 * 1024 * 1024) {
    throw new Error('DATA_MANIFEST_LIMIT');
  }
  const manifest = manifestSchema.parse(JSON.parse(await readFile(metadata, 'utf8')));
  const expected = { directories: manifest.directories, files: manifest.files };
  const payload = join(backup, 'data');
  if (JSON.stringify(await inventory(native, payload)) !== JSON.stringify(expected)) {
    throw new Error('DATA_BACKUP_CHANGED');
  }
  await destination(native, backup, output);
  await copy(native, payload, output, expected);
  return { files: expected.files.length, directories: expected.directories.length };
}

if (process.argv[1]?.endsWith('data-backup.cjs')) {
  void (async () => {
    const { values } = parseArgs({
      options: {
        mode: { type: 'string' },
        resource: { type: 'string' },
        source: { type: 'string' },
        output: { type: 'string' },
      },
    });
    if (
      !values.resource ||
      !values.source ||
      !values.output ||
      ![values.resource, values.source, values.output].every(isAbsolute) ||
      !['backup', 'restore'].includes(values.mode ?? '')
    ) {
      throw new Error('DATA_ARGUMENTS_INVALID');
    }
    const native = new NativeFileCommit(join(values.resource, 'native/file-commit.node'));
    const result =
      values.mode === 'backup'
        ? await backupData(native, values.source, values.output)
        : await restoreData(native, values.source, values.output);
    console.log(JSON.stringify({ ok: true, mode: values.mode, ...result }));
  })().catch(() => {
    console.error('Data copy failed; originals and partial evidence are preserved.');
    process.exitCode = 1;
  });
}
