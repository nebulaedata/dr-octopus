/**
 * @author Codex
 * @description Runs the standalone Server and adapts OS signals and development watcher shutdown requests.
 */
import { initializeServerEnvironment } from './lib/config/environment.js';

initializeServerEnvironment();
const { createServerHost } = await import('./host.js');

const runtime = createServerHost({
  onFailure: () => {
    process.exitCode = 1;
    void shutdown();
  },
});
let stopping = false;

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.on('message', (message: unknown) => {
  if (isDevWatchShutdownMessage(message)) {
    void shutdown();
  }
});
process.once('disconnect', () => void shutdown());

try {
  await runtime.start();
} catch (error) {
  if (!stopping) {
    console.error(error);
    process.exitCode = 1;
    process.disconnect?.();
  }
}

/**
 * Recognizes only the watcher's private, validated lifecycle command.
 */
function isDevWatchShutdownMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'octopus:dev-watch:shutdown' &&
    'reason' in message &&
    (message.reason === 'restart' || message.reason === 'shutdown')
  );
}

/**
 * Bounds shutdown at the standalone process boundary while the service owns resource cleanup.
 */
async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 30_000);
  deadline.unref();
  try {
    await runtime.stop();
    process.exit(process.exitCode ? 1 : 0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
