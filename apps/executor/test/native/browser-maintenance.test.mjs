/**
 * @author Codex
 * @description Verifies the real Windows registry adapter and installer entrypoint only with unique test Hosts and isolated complete bundles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostBundlePaths } from '../../src/contracts/browser-host-bundle.ts';
import { windowsBrowserRegistry } from '../../src/installation/windows/browser-host-platform.ts';
import { configureBrowserHost, inspectBrowserHost } from '../../src/main/browser-installation.ts';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const execute = promisify(execFile);

test(
  'process crash releases the native maintenance mutex and concurrent processes cannot acquire it',
  { skip: process.platform !== 'win32' },
  async () => {
    const binary = join(dist, 'native/file-commit.node');
    const native = createRequire(binary)(binary);
    const identity = randomBytes(32).toString('hex');
    const lease = native.lockMaintenance(identity);
    const probe = `const native=require(process.argv[1]);try{const lease=native.lockMaintenance(process.argv[2]);native.releaseMaintenance(lease)}catch{process.exitCode=7}`;
    try {
      await assert.rejects(
        execute(process.execPath, ['-e', probe, binary, identity]),
        (error) => error.code === 7
      );
    } finally {
      native.releaseMaintenance(lease);
    }
    await execute(process.execPath, [
      '-e',
      `require(process.argv[1]).lockMaintenance(process.argv[2]);process.exit(0)`,
      binary,
      identity,
    ]);
    const recovered = native.lockMaintenance(identity);
    native.releaseMaintenance(recovered);
  }
);

test(
  'portable repair and installer wrapper publish and remove only the unique current-user test Host',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'octopus-host-registry-'));
    const source = join(root, '完整 & source');
    const project = join(root, 'project');
    await mkdir(project);
    const bundle = JSON.parse(await readFile(join(dist, 'host-bundle.json'), 'utf8'));
    bundle.hostName = `com.octopus.executor.browser.dev_${randomBytes(8).toString('hex')}`;
    const registry = windowsBrowserRegistry(source);
    try {
      for (const path of [
        ...hostBundlePaths,
        'setup/browser-registry.ps1',
        'setup/browser-host.cjs',
        'setup/register-browser-host.ps1',
      ]) {
        await mkdir(dirname(join(source, path)), { recursive: true });
        await copyFile(join(dist, path), join(source, path));
      }
      await writeFile(join(source, 'host-bundle.json'), JSON.stringify(bundle));
      assert((await registry.inspect(bundle.hostName)).every((record) => record.path === null));
      const result = await configureBrowserHost(source, project);
      assert.equal(result.phase, 'ready');
      assert.equal(
        (
          await configureBrowserHost(source, project, undefined, {
            revision: result.revision,
            confirmReplacement: false,
          })
        ).phase,
        'ready'
      );
      const manifest = JSON.parse(
        await readFile(join(project, 'browser-host/registration/native-host.json'), 'utf8')
      );
      assert(manifest.path.startsWith(join(project, 'browser-host/versions')));
      assert(!manifest.path.startsWith(source));
      const entry = join(source, 'setup/browser-host.cjs');
      const original = await readFile(entry);
      const stopped = new AbortController();
      let processes = [];
      let pending;
      try {
        await writeFile(
          entry,
          `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('node:fs').writeFileSync(require('node:path').join(process.argv[4],'maintenance-pids.json'),JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`
        );
        pending = inspectBrowserHost(source, project, stopped.signal).catch((error) => error);
        const startedBy = Date.now() + 5000;
        while (Date.now() < startedBy && processes.length === 0) {
          processes = await readFile(join(project, 'maintenance-pids.json'), 'utf8')
            .then(JSON.parse)
            .catch(() => []);
          if (!processes.length) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        assert.equal(processes.length, 2);
        stopped.abort();
        assert.equal((await pending).name, 'AbortError');
        for (const pid of processes) {
          const deadline = Date.now() + 5000;
          let alive = true;
          while (alive && Date.now() < deadline) {
            try {
              process.kill(pid, 0);
            } catch {
              alive = false;
            }
            if (alive) {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
          assert.equal(
            alive,
            false,
            'Aborting the owned launcher must terminate its Node child and grandchild.'
          );
        }
      } finally {
        stopped.abort();
        await pending;
        for (const pid of processes) {
          try {
            process.kill(pid, 0);
            process.kill(pid);
          } catch {
            // The verified owned process has already exited; never search or kill by process name.
          }
        }
        await writeFile(entry, original);
      }
      // Load the copied native DLL in a disposable child so Windows can remove the fixture after it exits.
      await execute(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
        import assert from 'node:assert/strict';
        import { withBrowserMaintenanceLease, windowsBrowserRegistry } from ${JSON.stringify(new URL('../../src/installation/windows/browser-host-platform.ts', import.meta.url).href)};
        import { BrowserHostMaintenance } from ${JSON.stringify(new URL('../../src/maintenance/browser-host.ts', import.meta.url).href)};
        const [source, project] = process.argv.slice(1);
        await assert.rejects(withBrowserMaintenanceLease(source, () => withBrowserMaintenanceLease(source, async () => {})), /HOST_MAINTENANCE_BUSY/);
        await withBrowserMaintenanceLease(source, () => new BrowserHostMaintenance(source, project, windowsBrowserRegistry(source)).remove());
      `,
          source,
          project,
        ],
        { windowsHide: true, timeout: 20000 }
      );
      assert((await registry.inspect(bundle.hostName)).every((record) => record.path === null));
    } finally {
      // Finite removal checks the exact owned manifest again, including after an interrupted publication.
      const records = await registry.inspect(bundle.hostName).catch(() => []);
      for (const record of records.filter((item) => item.hive === 'CurrentUser')) {
        await registry.remove(
          bundle.hostName,
          record,
          join(project, 'browser-host/registration/native-host.json')
        );
      }
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
);
