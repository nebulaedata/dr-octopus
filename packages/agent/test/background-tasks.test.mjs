/**
 * @author Codex
 * @description Exercises background ownership races, bounded logs, cancellation and real process cleanup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { BackgroundTaskManager } from '../dist/extensions/background-task/services/task-manager.js';
import { createBackgroundTaskService } from '../dist/extensions/background-task/sdk/index.js';
import { assertManagedCommand } from '../dist/extensions/background-task/extension/guard.js';
import { registerBackgroundTools } from '../dist/extensions/background-task/extension/tools.js';
import { parseBackgroundTaskInput } from '../dist/extensions/background-task/validators/tool-input.js';

test('provider-facing background schema is an object and rejects malformed actions before service calls', async () => {
  let tool;
  registerBackgroundTools(
    {
      registerTool(value) {
        tool = value;
      },
      getActiveTools: () => ['background_task', 'bash'],
    },
    {}
  );
  const schema = JSON.parse(JSON.stringify(tool.parameters));
  assert.equal(schema.type, 'object');
  assert.equal(schema.anyOf, undefined);
  assert.equal(schema.oneOf, undefined);
  assert.deepEqual(schema.required, ['action']);
  const taskId = '22222222-2222-4222-8222-222222222222';
  for (const input of [
    { action: 'start', command: 'echo hello' },
    { action: 'list' },
    { action: 'status', taskId },
    { action: 'stop', taskId },
    { action: 'logs', taskId, cursor: 0, limitBytes: 65536 },
    { action: 'wait', taskId, timeoutMs: 30000 },
  ])
    assert.deepEqual(parseBackgroundTaskInput(input), input);
  for (const input of [
    { action: 'start' },
    { action: 'start', command: '' },
    { action: 'start', command: 'echo x', taskId },
    { action: 'stop' },
    { action: 'status', taskId: 'bad-id' },
    { action: 'list', command: 'echo x' },
    { action: 'logs', taskId, limitBytes: 65537 },
    { action: 'logs', taskId, cursor: -1 },
    { action: 'wait', taskId, timeoutMs: 30001 },
    { action: 'wait', taskId, timeoutMs: '10' },
    { action: 'unknown' },
    { action: 'list', extra: true },
  ])
    await assert.rejects(tool.execute('invalid', input), /INVALID_ARGUMENT/);
});

/**
 * Creates controllable process ownership independent of timing and operating-system behavior.
 */
function fixture() {
  let spawned;
  let ended;
  let output;
  let stops = 0;
  const done = new Promise((resolve) => {
    ended = resolve;
  });
  const manager = new BackgroundTaskManager({
    launch(_command, _cwd, onData) {
      output = onData;
      return new Promise((resolve) => {
        spawned = () =>
          resolve({
            done,
            stop() {
              stops++;
            },
          });
      });
    },
  });
  return {
    manager,
    spawn: () => spawned(),
    end: () => ended({ exitCode: 0 }),
    output: (data) => output(data),
    stops: () => stops,
  };
}

test('start racing stop is registered before spawn and cannot reopen admission', async () => {
  const f = fixture();
  const start = f.manager.start('work', '.', 'test', 'key');
  assert.equal(f.manager.snapshot().activeCount, 1);
  f.manager.beginStop('stop-a');
  await assert.rejects(f.manager.start('other', '.', 'test', 'other'), /SESSION_STOPPING/);
  f.spawn();
  const task = await start;
  assert.equal(task.state, 'stopping');
  assert.equal(f.stops(), 1);
  assert.throws(() => f.manager.finishStop('stop-a'), /STOP_UNCONFIRMED/);
  f.end();
  await f.manager.wait(task.taskId, 500);
  f.manager.finishStop('stop-a');
  assert.equal(f.manager.status(task.taskId).state, 'stopped');
});

test('wait cancellation preserves process; idempotency, ownership and ring output are bounded', async () => {
  const f = fixture();
  const starting = f.manager.start('work', '.', 'test', 'key');
  f.spawn();
  const task = await starting;
  assert.equal((await f.manager.start('work', '.', 'test', 'key')).taskId, task.taskId);
  await assert.rejects(f.manager.start('different', '.', 'test', 'key'), /CONFLICT/);
  assert.throws(() => new BackgroundTaskManager({}).status(task.taskId), /TASK_NOT_FOUND/);
  f.output(Buffer.alloc(2 * 1024 * 1024, 'x'));
  const logs = f.manager.readLogs(task.taskId, 0);
  assert.equal(logs.truncated, true);
  assert.equal(logs.text.length, 16384);
  const abort = new AbortController();
  const wait = f.manager.wait(task.taskId, 1000, abort.signal);
  abort.abort();
  await assert.rejects(wait, { name: 'AbortError' });
  assert.equal(f.stops(), 0);
  f.manager.stop(task.taskId);
  f.manager.stop(task.taskId);
  f.end();
  await f.manager.dispose();
});

test('guard rejects direct escape and allows quoted ampersands, redirection and logical AND', () => {
  for (const command of ['sleep 10 &', 'nohup sleep 10', 'setsid node x', 'disown']) {
    assert.throws(() => assertManagedCommand(command), /background_task/);
  }
  for (const command of [
    'echo "a & b"',
    "echo 'nohup & x'",
    'echo hi && echo bye',
    'echo hi 2>&1',
    '# nohup &\necho hi',
  ]) {
    assert.doesNotThrow(() => assertManagedCommand(command));
  }
  assert.doesNotThrow(() => assertManagedCommand('& "node.exe" -v', true));
  assert.throws(() => assertManagedCommand('Start-Process node', true), /background_task/);
  assert.throws(() => assertManagedCommand('Get-Process &', true), /background_task/);
});

test('hidden tools and Plan mode cannot start processes through stale tool calls', async () => {
  let tool;
  let tools = ['bash', 'background_task'];
  registerBackgroundTools(
    {
      registerTool(value) {
        tool = value;
      },
      getActiveTools: () => tools,
    },
    {}
  );
  const ctx = {
    cwd: '.',
    sessionManager: {
      getBranch: () => [{ type: 'custom', customType: 'plan-mode-state', data: { enabled: true } }],
    },
  };
  await assert.rejects(
    tool.execute('id', { action: 'start', command: 'echo hello' }, undefined, undefined, ctx),
    /Plan mode/
  );
  tools = ['bash'];
  await assert.rejects(tool.execute('id', { action: 'list' }, undefined, undefined, ctx), /NOT_AUTHORIZED/);
});

test('launcher failure is terminal and a pre-cancelled start creates no resource', async () => {
  let launches = 0;
  const manager = new BackgroundTaskManager({
    async launch() {
      launches++;
      throw new Error('JOB_ASSIGN_FAILED');
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(manager.start('work', '.', 'test', 'cancel', controller.signal));
  assert.equal(launches, 0);
  await assert.rejects(manager.start('work', '.', 'test', 'failed'), /JOB_ASSIGN_FAILED/);
  assert.equal(manager.snapshot().activeCount, 0);
  assert.equal(manager.snapshot().tasks[0].state, 'failed');
});

test(
  'real platform scope retains descendants after root exits and stops the entire scope',
  { timeout: 20000 },
  async (t) => {
    const manager = createBackgroundTaskService();
    t.after(() => manager.dispose());
    const node = process.execPath.replaceAll('\\', '/');
    const childScript = 'setInterval(()=>{},1000)';
    const script = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore',detached:${process.platform === 'win32'}});console.log('descendant='+c.pid);c.unref();`;
    const encoded = Buffer.from(script).toString('base64');
    const task = await manager.start(
      `"${node}" -e "eval(Buffer.from('${encoded}','base64').toString())"`,
      process.cwd(),
      'descendant test',
      'native'
    );
    let output = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      output = manager.readLogs(task.taskId).text;
      if (output.includes('descendant=')) break;
      await delay(50);
    }
    // Shell quoting below is POSIX, as required by the public bash tool contract.
    assert.match(output, /descendant=\d+/);
    await delay(200);
    assert.equal(manager.status(task.taskId).state, 'running');
    const pid = Number(output.match(/descendant=(\d+)/)[1]);
    manager.beginStop('native-stop');
    const ended = await manager.wait(task.taskId, 10000);
    assert.equal(ended.state, 'stopped');
    assert.throws(() => process.kill(pid, 0));
  }
);

test('real quick command preserves exit status and output', { timeout: 10000 }, async (t) => {
  const manager = createBackgroundTaskService();
  t.after(() => manager.dispose());
  const task = await manager.start('echo managed-output; exit 7', process.cwd(), 'short', 'short');
  const ended = await manager.wait(task.taskId, 5000);
  assert.equal(ended.state, 'exited');
  assert.equal(ended.exitCode, 7);
  assert.match(manager.readLogs(task.taskId).text, /managed-output/);
});
