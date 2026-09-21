/**
 * @author Codex
 * @description 验证 Agent 子进程环境使用平台兼容的文本编码
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSubprocessEncodingEnv } from '../dist/cli/prepare-env.js';

/**
 * Windows 上要求 WSL 输出 UTF-8，避免本地化诊断以 UTF-16LE 写入消息。
 */
test('enables UTF-8 output for WSL child processes on Windows', () => {
  const env = {};

  prepareSubprocessEncodingEnv('win32', env);

  assert.equal(env.WSL_UTF8, '1');
});

/**
 * 用户显式配置的 WSL 编码策略必须优先于应用默认值。
 */
test('preserves an explicit WSL UTF-8 setting', () => {
  const env = { WSL_UTF8: '0' };

  prepareSubprocessEncodingEnv('win32', env);

  assert.equal(env.WSL_UTF8, '0');
});

/**
 * 非 Windows 平台不应收到仅供 wsl.exe 使用的环境变量。
 */
test('does not add a WSL encoding variable on other platforms', () => {
  const env = {};

  prepareSubprocessEncodingEnv('linux', env);

  assert.equal('WSL_UTF8' in env, false);
});
