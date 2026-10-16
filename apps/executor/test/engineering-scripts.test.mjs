/**
 * @author Codex
 * @description Verifies JavaScript-only engineering entrypoints, explicit platform placeholders and safe archive behavior without changing product resources.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import { build } from 'esbuild';
import { executorTarget } from '../scripts/lib/platform.mjs';
import { extractZip, extractComputer, indexComputer, readZip } from '../scripts/lib/resources/archives.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

test('every engineering command is a package-addressable mjs entrypoint with no runtime TypeScript imports', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const files = (await readdir(join(root, 'scripts'), { recursive: true })).filter(
    (file) => file.endsWith('.mjs') && !file.replaceAll('\\', '/').startsWith('lib/')
  );
  assert.equal(
    (await readdir(join(root, 'scripts'), { recursive: true })).some((file) => /\.(ts|ps1)$/.test(file)),
    false
  );
  assert.ok(Object.values(pkg.scripts).every((command) => !command.startsWith('node scripts/lib/')));
  for (const file of files) {
    const entry = 'scripts/' + file.replaceAll('\\', '/');
    assert.ok(Object.values(pkg.scripts).includes('node ' + entry), entry);
    const result = await build({
      absWorkingDir: root,
      entryPoints: [entry],
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true,
    });
    assert.ok(
      Object.keys(result.metafile.inputs).every((file) => !/\.tsx?$/.test(file)),
      entry
    );
  }
  await promisify(execFile)(
    process.execPath,
    [
      '--no-experimental-strip-types',
      '--input-type=module',
      '-e',
      "await import('./scripts/lib/compile/application-api.mjs');",
    ],
    { cwd: root, windowsHide: true }
  );
});

test('Windows x64 is selected explicitly and macOS/Linux branches fail as unimplemented', () => {
  assert.equal(executorTarget('win32', 'x64').tar, 'tar.exe');
  assert.throws(() => executorTarget('win32', 'arm64'), /Windows x64/);
  assert.throws(() => executorTarget('darwin', 'arm64'), /macOS.*pending/);
  assert.throws(() => executorTarget('linux', 'x64'), /Linux.*pending/);
  assert.throws(() => executorTarget('freebsd', 'x64'), /Unsupported/);
});

test('archive extraction refuses traversal, aliases, overwrites and keeps wheel extraction/indexing consistent', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'octopus-archives-'));
  try {
    const archive = join(temporary, 'payload.zip');
    const target = join(temporary, 'output');
    await writeFile(archive, zipSync({ 'folder/hello.txt': strToU8('hello 世界') }));
    await extractZip(archive, target);
    assert.equal(await readFile(join(target, 'folder/hello.txt'), 'utf8'), 'hello 世界');
    await assert.rejects(extractZip(archive, target), /EEXIST/);
    for (const name of [
      '../escape.txt',
      '/absolute.txt',
      'C:/outside.txt',
      'folder/../escape.txt',
      'folder/name.',
      'folder/name ',
      'CON.txt',
    ]) {
      await writeFile(archive, zipSync({ [name]: strToU8('bad') }));
      await assert.rejects(readZip(archive), /path rejected|invalid zip/i);
    }
    await writeFile(archive, zipSync({ 'same.txt': strToU8('one'), 'SAME.TXT': strToU8('two') }));
    await assert.rejects(readZip(archive), /collision/);
    const python = join(temporary, 'python.zip');
    const wheel = join(temporary, 'wheel.zip');
    await writeFile(
      python,
      zipSync({ 'python.exe': strToU8('fixture'), 'python314._pth': strToU8('upstream') })
    );
    await writeFile(
      wheel,
      zipSync({
        'demo.data/purelib/demo.py': strToU8('module'),
        'demo.data/scripts/ignored': strToU8('ignored'),
        'demo.dist-info/LICENSE': strToU8('license'),
      })
    );
    const computer = join(temporary, 'computer');
    await extractComputer({ python, wheels: [wheel] }, computer);
    assert.equal(await readFile(join(computer, 'Lib/site-packages/demo.py'), 'utf8'), 'module');
    const inventory = await indexComputer({ python, wheels: [wheel] });
    assert.deepEqual(
      inventory.map((file) => file.path).sort(),
      [
        'resources/computer/python.exe',
        'resources/computer/Lib/site-packages/demo.py',
        'resources/computer/Lib/site-packages/demo.dist-info/LICENSE',
      ].sort()
    );
    const collision = join(temporary, 'collision.zip');
    await writeFile(collision, zipSync({ 'demo.py': strToU8('second') }));
    await assert.rejects(indexComputer({ python, wheels: [wheel, collision] }), /collision/);
    await mkdir(join(temporary, 'headers'));
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        ['scripts/resources/assemble-node-headers.mjs', '--cache-dir', join(temporary, 'headers')],
        { cwd: root, windowsHide: true }
      ),
      /EEXIST/
    );
  } finally {
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')));
    await rm(temporary, { recursive: true, force: true });
  }
});
