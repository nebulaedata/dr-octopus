/**
 * @author Codex
 * @description Verifies configured Executor artifacts cannot expose executable schemes or embedded credentials.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
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
