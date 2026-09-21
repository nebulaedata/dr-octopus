/**
 * @author Codex
 * @description Dedicated scheduler process entry, independent of Pi CLI and Host startup.
 */
import { runSchedulerLifecycleServer } from './lifecycle-server.js';

const [agentDir, mode, revision] = process.argv.slice(2);
if (!agentDir || (mode !== 'start' && mode !== 'ensure') || !/^\d+$/.test(revision ?? '')) {
  process.exitCode = 1;
} else {
  void runSchedulerLifecycleServer(agentDir, mode === 'start', Number(revision)).catch(() => {
    // No credential, request payload or inherited Runtime stderr is exposed.
    process.exitCode = 1;
  });
}
