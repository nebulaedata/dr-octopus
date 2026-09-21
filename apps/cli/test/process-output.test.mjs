/**
 * @author Codex
 * @description Verifies terminal output inheritance without changing captured stdout or JSON command streaming.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('build output inherits its channels while capture and JSON streaming keep their contracts', () => {
  for (const [mode, stdout, stderr] of [
    ['inherit', 'out|', 'err'],
    [false, '|out', ''],
    [true, '|out', 'outerr'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `
        import { execute } from ${JSON.stringify(new URL('../src/process.ts', import.meta.url).href)};
        const output = await execute(process.execPath, ['-e',
          'process.stdout.write("out"); setTimeout(() => process.stderr.write("err"), 50);'
        ], process.cwd(), ${JSON.stringify(mode)});
        process.stdout.write('|' + output);
      `,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 }
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, stderr);
  }
});

test('interactive commands receive stdin while capture modes remain noninteractive', () => {
  for (const mode of ['inherit', false, true]) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `
          import { execute } from ${JSON.stringify(new URL('../src/process.ts', import.meta.url).href)};
          const output = await execute(process.execPath, ['-e',
            'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(input || "closed"));'
          ], process.cwd(), ${JSON.stringify(mode)});
          process.stdout.write('|' + output);
        `,
      ],
      { input: 'patch\n', encoding: 'utf8', windowsHide: true, timeout: 10000 }
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stdout, mode === 'inherit' ? 'patch\n|' : '|closed');
  }
});
