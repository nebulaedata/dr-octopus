/**
 * @author Codex
 * @description Verifies registry validation, evidence-based installation diagnostics and credential-safe process output.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  effectiveRegistry,
  installationFailure,
  redactInstallOutput,
  registryUrl,
} from '../src/install-registry.ts';

test('registry override validates locally without invoking a package manager', async () => {
  assert.equal(
    await effectiveRegistry({ command: 'must-not-execute', args: [] }, '.', 'https://mirror.example'),
    'https://mirror.example/'
  );
  for (const value of [
    'file:///private',
    'ftp://example.com',
    'invalid-secret',
    'https://example.com/#fragment',
    '',
  ]) {
    assert.throws(
      () => registryUrl(value),
      (error) => error.code === 'INVALID_REGISTRY' && (!value || !error.message.includes(value))
    );
  }
});

test('diagnostics distinguish download, authentication and native failures without switching sources', () => {
  const failure = (message, registry = 'https://registry.npmjs.org/', explicit = false) =>
    installationFailure(new Error(message), registry, 'dr-octopus', explicit).message;
  assert.match(failure('ERR_PNPM_META_FETCH_FAIL ETIMEDOUT'), /registry.npmmirror.com/);
  assert.doesNotMatch(failure('ETIMEDOUT', 'https://enterprise.example/'), /registry.npmmirror.com/);
  assert.doesNotMatch(failure('ETIMEDOUT', undefined, true), /registry.npmmirror.com/);
  assert.match(failure('ERR_PNPM_FETCH_403'), /authentication/);
  assert.doesNotMatch(failure('ERR_PNPM_FETCH_403'), /registry.npmmirror.com/);
  assert.match(failure('prebuild-install ETIMEDOUT'), /native binary download host/);
  assert.doesNotMatch(failure('gyp ERR! build failed'), /registry.npmmirror.com/);
  assert.match(failure('unknown failure'), /Inspect the package-manager log/);
});

test('installer redaction strips URL credentials, query secrets and auth assignments', () => {
  const result = redactInstallOutput(
    'https://alice:password@example.com/pkg?key=secret _authToken=hidden Authorization: Bearer private'
  );
  assert.match(result, /https:\/\/example.com\/pkg/);
  assert.doesNotMatch(result, /alice|password|secret|hidden|private/);
});

test('streamed installer output is redacted across chunk boundaries and in final errors', () => {
  const executeModule = new URL('../src/process.ts', import.meta.url).href;
  const registryModule = new URL('../src/install-registry.ts', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
    import { execute } from ${JSON.stringify(executeModule)};
    import { redactInstallOutput } from ${JSON.stringify(registryModule)};
    try {
      await execute(process.execPath, ['-e', "process.stderr.write('https://alice:'); setTimeout(() => {process.stderr.write('secret@example.com/?token=private\\\\n'); process.exit(19);}, 30)"], process.cwd(), true, 10000, redactInstallOutput);
    } catch (error) { console.log(error.message); }
  `,
    ],
    { encoding: 'utf8', windowsHide: true }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exited with 19/);
  assert.match(result.stderr, /example.com/);
  assert.doesNotMatch(result.stdout + result.stderr, /alice|secret|private/);
});
