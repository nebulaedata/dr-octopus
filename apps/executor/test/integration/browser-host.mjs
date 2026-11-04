/**
 * @author Codex
 * @description Owns a unique test Native Host and copied browser bundles without changing production registration or build artifacts.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { hostBundlePaths } from '../../src/contracts/browser-host-bundle.ts';

/**
 * Copies fixed Host resources and redirects only owned extension copies to a fresh test registration.
 * @returns Fixture paths and explicit install/remove actions; callers close browsers before removing the Host and root.
 */
export async function createBrowserHostFixture({ root, appRoot, userData }) {
  await mkdir(join(userData, 'project'), { recursive: true });
  const resource = join(root, 'package');
  const name = 'com.octopus.executor.browser.dev_' + randomUUID().replaceAll('-', '').slice(0, 16);
  const script = join(resource, 'setup/register-browser-host.ps1');
  const productionName = 'com.octopus.executor.browser';
  for (const directory of ['native', 'bridge', 'resources/node']) {
    await mkdir(join(resource, directory), { recursive: true });
  }
  for (const file of [
    ...hostBundlePaths,
    'setup/register-browser-host.ps1',
    'setup/browser-host.cjs',
    'setup/browser-registry.ps1',
  ]) {
    await mkdir(dirname(join(resource, file)), { recursive: true });
    await copyFile(join(appRoot, 'dist', file), join(resource, file));
  }
  const bundle = JSON.parse(await readFile(join(appRoot, 'dist/host-bundle.json'), 'utf8'));
  await writeFile(join(resource, 'host-bundle.json'), JSON.stringify({ ...bundle, hostName: name }));

  /**
   * Registers or removes only this fixture's unique current-user Chrome/Edge Host entries.
   */
  async function register(mode) {
    assert.ok(['install', 'remove'].includes(mode));
    await promisify(execFile)(
      join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-File', script, mode, resource, join(userData, 'project')],
      { windowsHide: true, timeout: 60000 }
    );
  }

  /**
   * Returns one copied production bundle whose only change is the test Native Host name.
   */
  async function extensionDirectory(browser) {
    assert.ok(['chrome', 'edge'].includes(browser));
    const extension = join(root, browser + '-extension');
    await cp(resolve(appRoot, '../browser-extension/.output/' + browser + '-mv3'), extension, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    const background = join(extension, 'background.js');
    const source = await readFile(background, 'utf8');
    assert.equal(source.split(productionName).length, 2);
    await writeFile(background, source.replace(productionName, name));
    return extension;
  }

  return {
    source: resource,
    resource: join(userData, 'project/browser-host/versions'),
    register,
    extensionDirectory,
  };
}
