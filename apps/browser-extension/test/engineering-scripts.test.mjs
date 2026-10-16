/**
 * @author Codex
 * @description Guards JavaScript-only engineering entrypoints, fail-fast build ordering and the minimal package-manager-applied dependency patch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));

test('engineering entrypoints are package-addressable JavaScript and installed dependency matches the reviewed minimal patch', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const files = await readdir(join(root, 'scripts'), { recursive: true });
  assert.equal(
    files.some((file) => /\.(ts|ps1)$/.test(file)),
    false
  );
  assert.ok(Object.values(pkg.scripts).every((command) => !command.startsWith('node scripts/lib/')));
  for (const file of files.filter(
    (file) => file.endsWith('.mjs') && !file.replaceAll('\\', '/').startsWith('lib/')
  )) {
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
    assert.ok(Object.keys(result.metafile.inputs).every((file) => !/\.tsx?$/.test(file)));
  }
  const expected = JSON.parse(
    await readFile(join(root, 'test/fixtures/page-controller-hashes.json'), 'utf8')
  );
  for (const patch of expected) {
    const source = await readFile(join(root, 'node_modules', patch.file), 'utf8');
    assert.equal(createHash('sha256').update(source).digest('hex'), patch.sha256);
  }
});

test('a failed browser build prevents all remaining browser and license steps without requiring a TS loader', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'octopus-extension-build-'));
  try {
    const cli = join(temporary, 'pnpm-fixture.mjs');
    await writeFile(
      cli,
      "import {appendFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nappendFileSync(process.env.BUILD_TEST_LOG,JSON.stringify(args)+'\\n');\nif(process.env.BUILD_TEST_FAILURE==='first'||args.includes('edge'))process.exit(7);\n"
    );
    for (const failure of ['first', 'second']) {
      const log = join(temporary, failure + '.jsonl');
      await assert.rejects(
        promisify(execFile)(process.execPath, ['--no-experimental-strip-types', 'scripts/build.mjs'], {
          cwd: root,
          windowsHide: true,
          env: { ...process.env, npm_execpath: cli, BUILD_TEST_LOG: log, BUILD_TEST_FAILURE: failure },
        }),
        /Extension build step failed: 7/
      );
      const calls = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        calls,
        failure === 'first'
          ? [['exec', 'wxt', 'build']]
          : [
              ['exec', 'wxt', 'build'],
              ['exec', 'wxt', 'build', '-b', 'edge'],
            ]
      );
    }
  } finally {
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
    await rm(temporary, { recursive: true, force: true });
  }
});
