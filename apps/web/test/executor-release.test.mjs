/**
 * @author Codex
 * @description Verifies configured Executor artifacts cannot expose executable schemes or embedded credentials.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { executorReleaseDefines } from '../scripts/executor-release-config.ts';
import { readExecutorRelease } from '../src/features/executor-download/utils/executor-release.ts';

test('missing release links remain unavailable without inheriting the Web version', () => {
  assert.deepEqual(readExecutorRelease({}), {
    version: '0.0.1',
    installerUrl: undefined,
    archiveUrl: undefined,
  });
});

test('public artifact URLs and same-origin paths retain their exact release identity', () => {
  assert.deepEqual(
    readExecutorRelease({
      VITE_EXECUTOR_VERSION: ' 0.0.2-rc.1 ',
      VITE_EXECUTOR_WINDOWS_INSTALLER_URL: ' https://downloads.example.com/Executor%20Setup.exe?build=42 ',
      VITE_EXECUTOR_WINDOWS_ZIP_URL: '/downloads/executor-0.0.2-rc.1.zip',
    }),
    {
      version: '0.0.2-rc.1',
      installerUrl: 'https://downloads.example.com/Executor%20Setup.exe?build=42',
      archiveUrl: '/downloads/executor-0.0.2-rc.1.zip',
    }
  );
});

test('invalid and credential-bearing URLs never become download targets', () => {
  for (const value of [
    '',
    'javascript:alert(1)',
    'data:text/html,download',
    'file:///C:/Executor.exe',
    'https://user:password@example.com/executor.exe',
    '//example.com/executor.exe',
    'relative/executor.exe',
    'https://',
    '/\\example.com/executor.exe',
  ]) {
    assert.equal(
      readExecutorRelease({ VITE_EXECUTOR_WINDOWS_INSTALLER_URL: value }).installerUrl,
      undefined,
      value
    );
  }
});

test('each download format is independently available', () => {
  const release = readExecutorRelease({
    VITE_EXECUTOR_WINDOWS_ZIP_URL: 'http://localhost:8080/executor.zip',
  });
  assert.equal(release.installerUrl, undefined);
  assert.equal(release.archiveUrl, 'http://localhost:8080/executor.zip');
});

/**
 * Applies the public Vite define contract before passing configuration to the runtime reader.
 */
function builtEnvironment(defines) {
  return Object.fromEntries(
    Object.entries(defines).map(([key, value]) => [key.replace('import.meta.env.', ''), JSON.parse(value)])
  );
}

test('default downloads use the current repository Release with the independent Executor version', () => {
  const release = JSON.parse(readFileSync(new URL('../../../release.config.json', import.meta.url), 'utf8'));
  const executor = JSON.parse(readFileSync(new URL('../../executor/package.json', import.meta.url), 'utf8'));
  const environment = builtEnvironment(
    executorReleaseDefines(release.manifest.version, executor.version, {})
  );
  const configured = readExecutorRelease(environment);
  assert.equal(configured.version, executor.version);
  for (const [key, extension] of [
    ['installerUrl', 'exe'],
    ['archiveUrl', 'zip'],
  ]) {
    const url = new URL(configured[key]);
    assert.equal(url.origin, 'https://github.com');
    assert.equal(
      url.pathname,
      `/nebulaedata/dr-octopus/releases/download/v${release.manifest.version}/Dr.Octopus-Executor-${executor.version}-win-x64-unsigned.${extension}`
    );
  }
});

test('release defaults follow new tags and retain explicit mirrors or disabled formats', () => {
  const environment = builtEnvironment(
    executorReleaseDefines('3.2.1', '0.7.2', {
      VITE_EXECUTOR_WINDOWS_INSTALLER_URL: '/downloads/mirror.exe',
      VITE_EXECUTOR_WINDOWS_ZIP_URL: '',
    })
  );
  assert.deepEqual(readExecutorRelease(environment), {
    version: '0.7.2',
    installerUrl: '/downloads/mirror.exe',
    archiveUrl: undefined,
  });
  const next = builtEnvironment(executorReleaseDefines('3.2.2', '0.7.2', {}));
  assert.match(
    readExecutorRelease(next).archiveUrl,
    /releases\/download\/v3\.2\.2\/Dr\.Octopus-Executor-0\.7\.2/
  );
});
