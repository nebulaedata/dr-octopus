/**
 * @author Codex
 * @description Tests real supervised stdio MCP and owned descendant cleanup, without importing Python desktop control or operating user applications.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ComputerStdioTransport } from '../../src/runtime/computer/computer-stdio-transport.ts';
import { WindowsMcpConnection } from '../../src/runtime/computer/windows-mcp-connection.ts';

const supervisor = fileURLToPath(new URL('../../build/native/computer-supervisor.exe', import.meta.url));

/**
 * Confirms only fixture PIDs have exited, without signaling or enumerating unrelated processes.
 */
async function exited(pid) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Owned fixture process remained alive');
}

test('real native supervised MCP preserves stdio framing and only native cleanup confirms stop', async () => {
  const fixture = fileURLToPath(new URL('../fixtures/windows-mcp.mjs', import.meta.url));
  const transport = new ComputerStdioTransport(
    supervisor,
    process.execPath,
    fileURLToPath(new URL('../../', import.meta.url)),
    [fixture],
    { SystemRoot: process.env.SystemRoot }
  );
  const connection = await WindowsMcpConnection.connect(
    { transport: 'stdio' },
    { openLocal: async () => ({ transport, stop: () => transport.close() }) }
  );
  try {
    assert.deepEqual(connection.readStatus().toolNames, ['ExecutorDesktopMeta']);
    assert.deepEqual(await connection.close(), { executionStopConfirmed: true });
    await transport.close();
  } finally {
    await connection.close();
  }
});

test('malformed owned stdout drains private stderr and confirms Job cleanup', async () => {
  const secret = 'private-diagnostic-fixture-token';
  const transport = new ComputerStdioTransport(
    supervisor,
    process.execPath,
    fileURLToPath(new URL('../../', import.meta.url)),
    [
      '-e',
      `process.stderr.write(${JSON.stringify(secret)}.repeat(65536),()=>process.stdout.write('invalid-json\\n'));setInterval(()=>{},1000);`,
    ],
    { SystemRoot: process.env.SystemRoot }
  );
  await assert.rejects(
    WindowsMcpConnection.connect(
      { transport: 'stdio' },
      {
        openLocal: async () => ({ transport, stop: () => transport.close() }),
      }
    ),
    /WINDOWS_MCP_CONNECTION_FAILED/
  );
  await transport.close();
});

test('stdio EOF cleans the complete actual owned tree rather than only its root PID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-computer-tree-'));
  const marker = join(root, 'tree.json');
  const fixture = join(root, 'fixture.mjs');
  await writeFile(
    fixture,
    `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});writeFileSync(${JSON.stringify(marker)},JSON.stringify({root:process.pid,child:child.pid}));setInterval(()=>{},1000);`
  );
  const child = spawn(supervisor, [process.execPath, root, String(process.pid), fixture], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.resume();
  child.stderr.resume();
  const done = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  try {
    let tree;
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        tree = JSON.parse(await readFile(marker, 'utf8'));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.ok(tree);
    child.stdin.end();
    assert.equal(await done, 0);
    await Promise.all([exited(tree.root), exited(tree.child)]);
  } finally {
    child.stdin.end();
    await done;
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-computer-tree-')));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('parent process loss cleans only its supervised fixture Job and its descendants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-computer-parent-'));
  const marker = join(root, 'tree.json');
  const fixture = join(root, 'fixture.mjs');
  const parent = join(root, 'parent.mjs');
  await writeFile(
    fixture,
    `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});writeFileSync(${JSON.stringify(marker)},JSON.stringify({root:process.pid,child:child.pid}));setInterval(()=>{},1000);`
  );
  await writeFile(
    parent,
    `import{spawn}from'node:child_process';import{existsSync}from'node:fs';spawn(${JSON.stringify(supervisor)},[process.execPath,${JSON.stringify(root)},String(process.pid),${JSON.stringify(fixture)}],{stdio:['pipe','ignore','ignore'],windowsHide:true});const timer=setInterval(()=>{if(existsSync(${JSON.stringify(marker)})){clearInterval(timer);process.exit(0)}},10);`
  );
  const owner = spawn(process.execPath, [parent], { stdio: 'ignore', windowsHide: true });
  try {
    assert.equal(await new Promise((resolve) => owner.once('close', resolve)), 0);
    const tree = JSON.parse(await readFile(marker, 'utf8'));
    await Promise.all([exited(tree.root), exited(tree.child)]);
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'octopus-computer-parent-')));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
