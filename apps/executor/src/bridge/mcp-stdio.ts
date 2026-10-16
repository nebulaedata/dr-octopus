/**
 * @author Codex
 * @description Runs only the adjacent private stdio adapter against an already running Runtime with SID-private exported credentials.
 */
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { NativeFileCommit } from '../runtime/basic/native-file-commit';
import { readStdioConfig } from './stdio-config';
import { runStdioHttp } from './stdio-http';

const lifetime = new AbortController();
// Windows process.stdout pipe writes block the event loop; asynchronous fs writes keep EOF and exit timers live.
const output = createWriteStream('', { fd: 1, autoClose: false });
let terminateCurrentProcess: (() => never) | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
/**
 * Bounds exit even when stdout is blocked; only this adapter process is terminated by the deadline.
 */
function closing() {
  deadline ??= setTimeout(() => {
    if (terminateCurrentProcess) {
      terminateCurrentProcess();
    }
    process.exit(1);
  }, 5000);
}
/**
 * Stops adapter admission; Runtime remains authoritative for dispatched actions and cleanup evidence.
 */
function stop() {
  closing();
  lifetime.abort();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.stdin.once('end', closing);
process.stdin.once('close', closing);
output.once('error', stop);
/**
 * Reads fixed package infrastructure and a protected identity before any protocol request.
 */
async function main() {
  terminateCurrentProcess = (
    createRequire(join(__dirname, 'mcp-stdio.cjs'))(join(__dirname, '..', 'native', 'stdio-exit.node')) as {
      terminateCurrentProcess: () => never;
    }
  ).terminateCurrentProcess;
  const native = new NativeFileCommit(join(__dirname, '..', 'native', 'file-commit.node'));
  const config = await readStdioConfig(
    native,
    process.argv.slice(2),
    join(__dirname, '..', 'native', 'mcp-launcher.exe')
  );
  await runStdioHttp(process.stdin, output, config, lifetime.signal);
}
void main()
  .catch(() => {
    console.error('[mcp-stdio] Connection ended.');
    process.exitCode = 1;
  })
  .finally(() => {
    closing();
    process.stdin.destroy();
    output.end(() => {
      clearTimeout(deadline);
      process.exit(process.exitCode ?? 0);
    });
  });
