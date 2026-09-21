/**
 * @author Codex
 * @description Verifies that dependency consent preserves terminal mode and cancels cleanly on process interruption.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

test('dependency prompt handles SIGINT without raw mode and removes signal listeners', async () => {
  const entry = new URL('../src/dependency-prompt.ts', import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
    import { confirmDependencyInstall } from ${JSON.stringify(entry)};
    const listeners = process.listenerCount('SIGINT');
    process.stdin.setRawMode = () => { throw new Error('Prompt must not enable raw mode'); };
    process.once('message', () => process.emit('SIGINT'));
    const pending = confirmDependencyInstall();
    process.send('ready');
    try { await pending; process.exitCode = 2; }
    catch (error) {
      console.log(JSON.stringify({code: error.code, clean: process.listenerCount('SIGINT') === listeners}));
    } finally { process.disconnect(); }
  `,
    ],
    { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true }
  );
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  child.once('message', () => child.send('interrupt'));
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, 0, errors);
    assert.deepEqual(JSON.parse(output), { code: 'INSTALL_CANCELLED', clean: true });
  } finally {
    clearTimeout(timer);
    child.stdin.destroy();
  }
});
