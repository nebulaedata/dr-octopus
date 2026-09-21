/**
 * @author Codex
 * @description 可注入退出、协议损坏和分片输出的 Agent RPC 测试子进程
 */

import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });
const sessionArgumentIndex = process.argv.indexOf('--session');
let activeSession =
  sessionArgumentIndex < 0 ? `session-${String(process.pid)}.jsonl` : process.argv[sessionArgumentIndex + 1];
let active = false;

/**
 * 写入标准 RPC 成功响应。
 *
 * @param {Record<string, unknown>} command 输入命令
 * @param {unknown} data 可选响应数据
 */
function respond(command, data) {
  process.stdout.write(
    `${JSON.stringify({
      id: command.id,
      type: 'response',
      command: command.type,
      success: true,
      ...(data === undefined ? {} : { data }),
    })}\n`
  );
}

lines.on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type === 'test_environment') {
    respond(command, {
      value: process.env.OCTOPUS_TEST_CHILD_VALUE,
      inherited: process.env.OCTOPUS_TEST_PARENT_VALUE,
    });
    return;
  }
  if (command.type === 'test_crash') {
    process.stderr.write('fixture crash diagnostic\n', () => process.exit(23));
    return;
  }
  if (command.type === 'test_invalid_json') {
    process.stdout.write('{invalid json}\n');
    return;
  }
  if (command.type === 'test_split_utf8') {
    const output = Buffer.from(
      `${JSON.stringify({
        id: command.id,
        type: 'response',
        command: command.type,
        success: true,
        data: { text: '汉字\u2028仍在同一帧' },
      })}\n`
    );
    const splitAt = output.indexOf(Buffer.from('汉')) + 1;
    process.stdout.write(output.subarray(0, splitAt));
    setImmediate(() => process.stdout.write(output.subarray(splitAt)));
    return;
  }
  if (command.type === 'test_hang') {
    return;
  }
  if (command.type === 'test_begin') {
    active = true;
    respond(command);
    process.stdout.write(`${JSON.stringify({ type: 'agent_start' })}\n`);
    return;
  }
  if (command.type === 'test_failure') {
    process.stdout.write(
      `${JSON.stringify({
        id: command.id,
        type: 'response',
        command: command.type,
        success: false,
        error: 'fixture rejected command',
      })}\n`
    );
    return;
  }
  if (command.type === 'switch_session') {
    activeSession = command.sessionPath;
    respond(command, { cancelled: false });
    return;
  }
  if (command.type === 'abort') {
    active = false;
    process.stdout.write(`${JSON.stringify({ type: 'agent_settled' })}\n`);
    respond(command);
    return;
  }
  respond(
    command,
    command.type === 'get_state'
      ? {
          thinkingLevel: 'medium',
          isStreaming: active,
          isCompacting: false,
          steeringMode: 'all',
          followUpMode: 'all',
          sessionId: 'test-session',
          sessionFile: activeSession,
          autoCompactionEnabled: true,
          messageCount: 0,
          pendingMessageCount: 0,
        }
      : undefined
  );
});
