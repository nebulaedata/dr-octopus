/**
 * @author Codex
 * @description Copies locally installed production dependency notices into each independently distributable browser bundle.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = process.env.npm_execpath;
if (!cli) {
  throw new Error('Run extension builds through pnpm.');
}
const { stdout } = await promisify(execFile)(
  process.execPath,
  [cli, '--filter', '@octopus/browser-extension', 'licenses', 'list', '--prod', '--json'],
  { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
);
const inventory = JSON.parse(stdout);
const notices = [];
const recorded = new Set();
/**
 * Records each installed package once and fails rather than silently omitting a required notice.
 */
async function record(directory, license) {
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const key = pkg.name + '@' + pkg.version;
  if (recorded.has(key)) {
    return;
  }
  const files = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && /^(?:licen[cs]e|copying|notice|ofl)(?:$|[.-])/i.test(entry.name)
  );
  const contents = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      bytes: await readFile(join(directory, file.name)),
    }))
  );
  // This pinned upstream npm files list omits LICENSE; preserve the repository tag's original notice.
  if (!contents.length && key === '@ai-sdk/provider-utils@5.0.70' && pkg.license === 'Apache-2.0') {
    const bytes = await readFile(join(root, 'public/licenses/ai-sdk-provider-utils-5.0.70.txt'));
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      'b4f9adb7c568904834d0dd6cc98d16c390d21ca32fc17ae7a267715269bd5529'
    ) {
      throw new Error('Pinned AI SDK notice digest mismatch');
    }
    contents.push({ name: 'LICENSE', bytes });
  }
  if (!contents.length) {
    throw new Error(`Missing dependency notice: ${key}`);
  }
  recorded.add(key);
  notices.push({ name: pkg.name, version: pkg.version, license: license ?? pkg.license, contents });
}
for (const dependencies of Object.values(inventory)) {
  for (const dependency of dependencies) {
    if (dependency.name.startsWith('@octopus/')) {
      continue;
    }
    for (const directory of dependency.paths) {
      await record(directory, dependency.license);
    }
  }
}
/**
 * Follows the selected shared UI runtime imports, since pnpm's application license query stops at workspace packages.
 * CSS-only packages contribute their notices without pulling the shadcn CLI into the extension inventory.
 */
async function collect(name, from, runtime = true) {
  const require = createRequire(from);
  let pkgPath;
  for (const directory of require.resolve.paths(name) ?? []) {
    const candidate = join(directory, name, 'package.json');
    try {
      if (JSON.parse(await readFile(candidate, 'utf8')).name === name) {
        pkgPath = await realpath(candidate);
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  if (!pkgPath) {
    throw new Error(`Installed package metadata not found: ${name}`);
  }
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  if (recorded.has(pkg.name + '@' + pkg.version)) {
    return;
  }
  await record(dirname(pkgPath), pkg.license);
  if (runtime) {
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      await collect(dependency, pkgPath);
    }
  }
}
const shared = fileURLToPath(new URL('../../../packages/shared/package.json', import.meta.url));
await collect('yaml', shared);
const ui = fileURLToPath(new URL('../../../packages/ui/package.json', import.meta.url));
for (const name of ['@base-ui/react', 'class-variance-authority', 'clsx', 'tailwind-merge']) {
  await collect(name, ui);
}
for (const name of ['@fontsource-variable/geist', 'tw-animate-css', 'shadcn']) {
  await collect(name, ui, false);
}
for (const flavor of ['chrome', 'edge']) {
  const target = join(root, '.output', `${flavor}-mv3`, 'licenses', 'dependencies');
  for (const notice of notices) {
    const directory = join(target, encodeURIComponent(notice.name) + '@' + notice.version);
    await mkdir(directory, { recursive: true });
    for (const file of notice.contents) {
      await writeFile(join(directory, file.name), file.bytes);
    }
  }
  await writeFile(
    join(target, 'inventory.json'),
    JSON.stringify(
      notices.map(({ name, version, license }) => ({ name, version, license })),
      null,
      2
    )
  );
}
console.log(`Preserved ${notices.length} production dependency notices in each browser bundle.`);
