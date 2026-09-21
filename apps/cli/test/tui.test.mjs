/**
 * @author Codex
 * @description Verifies public Agent binary discovery and foreground terminal input, output and exit behavior.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveAgentBinary } from '../src/tui.ts';

test('Agent binary follows its public manifest in a relocated runtime', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus tui '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agent = join(root, 'node_modules', '@octopus', 'agent');
  await mkdir(agent, { recursive: true });
  const manifest = join(agent, 'package.json');
  await writeFile(manifest, JSON.stringify({ bin: { octopus: './output/terminal.js' } }));
  assert.equal(await resolveAgentBinary(root), join(agent, 'output', 'terminal.js'));
  await writeFile(manifest, JSON.stringify({ bin: { octopus: '../escape.js' } }));
  await assert.rejects(resolveAgentBinary(root), /Invalid release-relative path/);
  await writeFile(manifest, '{}');
  await assert.rejects(resolveAgentBinary(root), /does not declare/);
});

test('Foreground Agent inherits cwd, environment and stdin, preserves argv and nonzero exit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'octopus tui terminal '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = join(root, 'agent.mjs');
  await writeFile(
    entry,
    `
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    console.log(JSON.stringify({ input, args: process.argv.slice(2), cwd: process.cwd(), env: process.env.OCTOPUS_TUI_TEST }));
    console.error('agent diagnostic');
    process.exitCode = 7;
  `
  );
  const moduleUrl = new URL('../src/tui.ts', import.meta.url).href;
  const args = ['--workspace', 'a b', '--model=x', 'literal $value; & text'];
  const child = spawn(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      '--input-type=module',
      '--eval',
      `
    const { runAgentTerminal } = await import(${JSON.stringify(moduleUrl)});
    const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    process.exitCode = await runAgentTerminal(${JSON.stringify(entry)}, ${JSON.stringify(args)});
    if (before.some((count, index) => count !== process.listenerCount(['SIGINT', 'SIGTERM'][index]))) throw new Error('Leaked listeners');
  `,
    ],
    { cwd: root, env: { ...process.env, OCTOPUS_TUI_TEST: 'inherited' }, stdio: 'pipe' }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  child.stdin.end('terminal input\n');
  assert.equal(await completed, 7, stderr);
  assert.deepEqual(JSON.parse(stdout), { input: 'terminal input\n', args, cwd: root, env: 'inherited' });
  assert.equal(stderr, 'agent diagnostic\n');
});
