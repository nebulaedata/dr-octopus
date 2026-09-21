/**
 * @author Codex
 * @description 验证 Octopus 对 Pi 交互式 Agent TUI 启动参数的判定
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isInteractiveTuiLaunch,
  runInteractiveInstall,
} from '../dist/cli/terminal-ui.js';

const TTY = { stdinIsTTY: true, stdoutIsTTY: true };

/** 验证普通 Agent 参数及 text mode 会进入交互式 TUI。 */
test('recognizes interactive Pi Agent launches', () => {
  assert.equal(isInteractiveTuiLaunch([], TTY), true);
  assert.equal(isInteractiveTuiLaunch(['review this project'], TTY), true);
  assert.equal(isInteractiveTuiLaunch(['--continue'], TTY), true);
  assert.equal(isInteractiveTuiLaunch(['--mode', 'text'], TTY), true);
  assert.equal(isInteractiveTuiLaunch(['--tui-mode', 'fullscreen'], TTY), true);
});

/** 验证 Pi 的输出模式与一次性操作不会启动 Agent TUI。 */
test('rejects non-interactive modes and one-shot operations', () => {
  assert.equal(isInteractiveTuiLaunch(['--print', 'hello'], TTY), false);
  assert.equal(isInteractiveTuiLaunch(['-p', 'hello'], TTY), false);
  assert.equal(isInteractiveTuiLaunch(['--mode', 'json'], TTY), false);
  assert.equal(isInteractiveTuiLaunch(['--mode', 'rpc'], TTY), false);
  assert.equal(isInteractiveTuiLaunch(['--help'], TTY), false);
  assert.equal(isInteractiveTuiLaunch(['--version'], TTY), false);
  assert.equal(isInteractiveTuiLaunch(['--list-models'], TTY), false);
  assert.equal(isInteractiveTuiLaunch(['--export', 'session.jsonl'], TTY), false);
});

/** 验证 Pi 在常规参数解析前处理的独立命令不会进入 Agent TUI。 */
test('rejects Pi commands handled before Agent startup', () => {
  for (const command of [
    'auth',
    'config',
    'install',
    'list',
    'remove',
    'uninstall',
    'update',
  ]) {
    assert.equal(isInteractiveTuiLaunch([command], TTY), false, command);
  }
});

/** 验证 stdin 或 stdout 被重定向时 Pi 会选择 print mode。 */
test('requires both stdin and stdout to be TTYs', () => {
  assert.equal(
    isInteractiveTuiLaunch([], { stdinIsTTY: false, stdoutIsTTY: true }),
    false
  );
  assert.equal(
    isInteractiveTuiLaunch([], { stdinIsTTY: true, stdoutIsTTY: false }),
    false
  );
});

/** 验证参数错误会在 Pi 启动 TUI 前退出。 */
test('rejects arguments that Pi parses as errors', () => {
  assert.equal(isInteractiveTuiLaunch(['--tui-mode', 'invalid'], TTY), false);
  assert.equal(isInteractiveTuiLaunch(['-unknown'], TTY), false);
});

/** 验证重定向输出时不初始化 TUI，但仍完整执行安装操作。 */
test('runs installation without animation outside a TTY', async () => {
  let calls = 0;
  const result = await runInteractiveInstall(
    async () => {
      calls += 1;
      return 'installed';
    },
    {},
    { stdinIsTTY: false, stdoutIsTTY: false }
  );

  assert.equal(result, 'installed');
  assert.equal(calls, 1);
});

/** 验证静默安装跳过确认和进度输出，适用于 Server 启动。 */
test('runs silent installation without confirmation or animation', async () => {
  const result = await runInteractiveInstall(
    async () => 'installed',
    {
      silent: true,
      confirmText: '不应展示此确认文案',
    },
    TTY
  );

  assert.equal(result, 'installed');
});
