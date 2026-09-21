/**
 * @author Codex
 * @description Guards line-oriented progress and ensures keyboard and signal ownership stay with the CLI.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { progress } from '../src/output.ts';

test('progress prints distinct phase transitions and completion once', (t) => {
  const output = t.mock.method(console, 'error', () => {});
  const indicator = progress({}, 'Starting Gateway');
  indicator.message('Gateway: extensions');
  indicator.message('Gateway: extensions');
  indicator.message('Gateway: ready');
  indicator.stop('Gateway ready');
  indicator.stop('Gateway startup failed');
  indicator.message('late update');
  assert.deepEqual(
    output.mock.calls.map(({ arguments: args }) => args),
    [['Starting Gateway'], ['Gateway: extensions'], ['Gateway: ready'], ['Gateway ready']]
  );
});

test('JSON commands emit no progress', (t) => {
  const output = t.mock.method(console, 'error', () => {});
  const indicator = progress({ json: true }, 'Starting Gateway');
  indicator.message('Gateway: ready');
  indicator.stop('Gateway ready');
  assert.equal(output.mock.callCount(), 0);
});

test('TTY progress never accesses stdin or adds cancellation handlers', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    Object.defineProperty(process.stderr, 'isTTY', { value: true });
    Object.defineProperty(process, 'stdin', { get() { throw new Error('stdin must remain untouched'); } });
    const { progress } = await import(${JSON.stringify(new URL('../src/output.ts', import.meta.url).href)});
    for (const phase of ['starting', 'ready']) {
      let handled = false;
      const cancel = () => { handled = true; };
      process.once('SIGINT', cancel);
      const handlers = process.rawListeners('SIGINT');
      const indicator = progress({}, 'Starting Gateway');
      assert.deepEqual(process.rawListeners('SIGINT'), handlers);
      if (phase === 'ready') indicator.stop('Gateway ready');
      process.emit('SIGINT');
      assert.equal(handled, true);
      indicator.stop('Stopped');
    }
  `,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 }
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stderr.includes('\u001b'), false);
});
