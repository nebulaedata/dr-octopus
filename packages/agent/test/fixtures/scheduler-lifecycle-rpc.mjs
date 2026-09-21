/**
 * @author Codex
 * @description Deterministic RPC Runtime that starts the real daemon through the Agent lifecycle SDK.
 */
import { createInterface } from 'node:readline';
import { startSchedulerService } from '../../dist/extensions/scheduler/sdk/lifecycle.js';

const lines = createInterface({ input: process.stdin });
lines.on('line', async (line) => {
  const command = JSON.parse(line);
  if (command.type === 'test_crash') {
    process.exit(23);
  }
  const data =
    command.type === 'test_start_scheduler'
      ? await startSchedulerService(command.agentDir)
      : { isStreaming: false, isCompacting: false, sessionFile: 'fixture.jsonl' };
  process.stdout.write(
    JSON.stringify({ type: 'response', command: command.type, id: command.id, success: true, data }) + '\n'
  );
});
