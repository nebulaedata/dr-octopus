/**
 * @author Codex
 * @description Waits for parent ownership confirmation before spawning a user shell with inherited output.
 */
import { spawn } from 'node:child_process';

// This trusted runner executes no workspace code until its parent establishes a Job/process group.
process.once('message', (message: { shell: string; args: string[]; command: string; cwd: string }) => {
  const child = spawn(message.shell, [...message.args, message.command], {
    cwd: message.cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  child.once('error', () => process.exit(127));
  child.once('exit', (code) => process.exit(code ?? 1));
});
process.on('disconnect', () => {
  if (process.platform !== 'win32') {
    try {
      process.kill(-process.pid, 'SIGKILL');
    } catch {
      process.exit(1);
    }
  } else {
    process.exit(1);
  }
});
