/**
 * @author Codex
 * @description 测试专用的最小 JSONL RPC 子进程
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

const lines = createInterface({ input: process.stdin });
const sessionIndex = process.argv.indexOf('--session');
const sessionFile = sessionIndex < 0 ? undefined : process.argv[sessionIndex + 1];
const sessionId = sessionFile === undefined ? `new-${String(process.pid)}` : process.env.MOCK_SESSION_ID;
const model = process.env.MOCK_MODEL_CONFIG ? JSON.parse(readFileSync(process.env.MOCK_MODEL_CONFIG, 'utf8')) : undefined;

lines.on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type === 'extension_ui_response') {
    return;
  }
  const response = {
    id: command.id,
    type: 'response',
    command: command.type,
    success: command.type !== 'compact',
    ...(command.type === 'compact' ? { error: 'Nothing to compact (session too small)' } : {}),
    ...(command.type === 'get_state'
      ? {
          data: {
            ...(model ? { model } : {}),
            thinkingLevel: 'medium',
            isStreaming: false,
            isCompacting: false,
            steeringMode: 'all',
            followUpMode: 'all',
            sessionId,
            sessionFile,
            autoCompactionEnabled: true,
            messageCount: 0,
            pendingMessageCount: 0,
          },
        }
      : command.type === 'get_commands'
        ? { data: { commands: [] } }
        : command.type === 'get_available_thinking_levels'
          ? { data: { levels: ['off', 'minimal', 'low', 'medium', 'high'] } }
          : command.type === 'get_available_models'
            ? { data: { models: [] } }
            : {}),
  };

  const writeResponse = () => process.stdout.write(`${JSON.stringify(response)}\n`);
  const responseDelayMs = Number(process.env.MOCK_RESPONSE_DELAY_MS ?? '0');
  if (responseDelayMs > 0) {
    setTimeout(writeResponse, responseDelayMs);
  } else {
    writeResponse();
  }
  if (command.type === 'prompt' && command.message === '__running__') {
    process.stdout.write(`${JSON.stringify({ type: 'agent_start' })}\n`);
  }
  if (command.type === 'compact') {
    process.stdout.write(`${JSON.stringify({ type: 'compaction_start', reason: 'manual' })}\n`);
    process.stdout.write(
      `${JSON.stringify({
        type: 'compaction_end',
        reason: 'manual',
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage: 'Compaction failed: Nothing to compact (session too small)',
      })}\n`
    );
  }
  if (command.type === 'prompt' && command.message === '__ui__') {
    process.stdout.write(
      `${JSON.stringify({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Confirm', message: 'Continue?' })}\n`
    );
  }
  if (command.type === 'prompt' && command.message === '__crash__') {
    process.stdout.write('', () => process.exit(17));
  }
});
