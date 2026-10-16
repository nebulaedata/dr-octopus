/**
 * @author Codex
 * @description Preserves declared production dependency notices alongside the built application without shipping dependency code.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createHash } from 'node:crypto';
/**
 * Collects the locally installed production dependency graph; pnpm performs no install or network acquisition.
 */
export async function packageLicenses(root, target) {
  const cli = process.env.npm_execpath;
  if (!cli) {
    throw new Error('Run packaging through the checked-in pnpm command.');
  }
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, '--filter', '@octopus/executor', 'licenses', 'list', '--prod', '--json'],
      { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('License inventory deadline exceeded.'));
    }, 30000);
    child.stdout.on('data', (bytes) => {
      stdout += bytes.toString();
      if (stdout.length > 4 * 1024 * 1024) {
        child.kill();
        reject(new Error('License inventory exceeds limit.'));
      }
    });
    child.stderr.on('data', (bytes) => {
      stderr = (stderr + bytes.toString()).slice(-8192);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`License inventory failed: ${stderr}`));
      }
    });
  });
  const inventory = z
    .record(
      z.string(),
      z.array(
        z.object({
          name: z.string(),
          versions: z.array(z.string()),
          paths: z.array(z.string()),
          license: z.string(),
        })
      )
    )
    .parse(JSON.parse(output));
  const records = [];
  await mkdir(target, { recursive: true });
  for (const packages of Object.values(inventory)) {
    for (const dependency of packages) {
      if (dependency.name.startsWith('@octopus/')) {
        continue;
      }
      for (const directory of dependency.paths) {
        const pkg = z
          .object({ version: z.string() })
          .parse(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')));
        const notices = (await readdir(directory)).filter((name) =>
          /^(?:licen[cs]e|copying|notice|ofl)(?:$|[.-])/i.test(name)
        );
        if (!notices.length && dependency.name === '@cfworker/json-schema' && pkg.version === '4.1.1') {
          const bytes = await readFile(join(root, 'vendor/notices/cfworker-json-schema-4.1.1-LICENSE'));
          if (
            createHash('sha256').update(bytes).digest('hex') !==
            '376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094'
          ) {
            throw new Error('Pinned cfworker notice digest mismatch.');
          }
          const destination = join(target, encodeURIComponent(dependency.name) + '@' + pkg.version);
          await mkdir(destination, { recursive: true });
          await writeFile(join(destination, 'LICENSE'), bytes);
          records.push({
            name: dependency.name,
            version: pkg.version,
            license: dependency.license,
            notices: ['LICENSE'],
          });
          continue;
        }
        if (!notices.length) {
          throw new Error(`Missing third-party notice: ${dependency.name}@${pkg.version}`);
        }
        const destination = join(target, encodeURIComponent(dependency.name) + '@' + pkg.version);
        await mkdir(destination, { recursive: true });
        for (const name of notices) {
          await writeFile(join(destination, name), await readFile(join(directory, name)));
        }
        records.push({ name: dependency.name, version: pkg.version, license: dependency.license, notices });
      }
    }
  }
  await writeFile(join(target, 'inventory.json'), JSON.stringify(records, null, 2));
}
