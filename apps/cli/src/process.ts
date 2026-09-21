/**
 * @author Codex
 * @description Executes package-manager and isolated runtime checks with cancellation and bounded diagnostics.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Runs an argv command without shell interpolation and returns bounded stdout or a diagnostic error.
 * Inherit mode connects input and output directly to the terminal and returns an empty string; capture modes retain stdout.
 */
export async function execute(
  command: string,
  args: string[],
  cwd: string,
  stream: boolean | 'inherit' = false,
  timeout = 120_000,
  sanitize?: (value: string) => string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const destination = stream === 'inherit' ? 'inherit' : 'pipe';
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: [stream === 'inherit' ? 'inherit' : 'ignore', destination, destination],
    });
    let output = '';
    let errors = '';
    const cancel = () => child.kill();
    const timer = setTimeout(cancel, timeout);
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    child.stdout?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-262144);
      if (stream === true && !sanitize) {
        process.stderr.write(chunk);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-262144);
      if (stream === true && !sanitize) {
        process.stderr.write(chunk);
      }
    });
    if (stream === true && sanitize) {
      for (const source of [child.stdout, child.stderr]) {
        if (source) {
          createInterface({ input: source }).on('line', (line) =>
            process.stderr.write(sanitize(line) + '\n')
          );
        }
      }
    }
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
      if (code === 0) {
        resolve(output.trim());
      } else {
        const diagnostic = `${command} exited with ${String(code)}: ${errors}\n${output}`;
        reject(new Error(sanitize ? sanitize(diagnostic) : diagnostic));
      }
    });
  });
}

/**
 * Resolves pnpm's JS entry on Windows so arguments never pass through cmd.exe quoting.
 */
export async function pnpmCommand(cwd: string): Promise<{ command: string; args: string[] }> {
  if (process.platform !== 'win32') {
    return { command: 'pnpm', args: [] };
  }
  const { access } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  const paths = (await execute('where.exe', ['pnpm'], cwd)).split(/\r?\n/);
  for (const path of paths) {
    for (const entry of [
      join(dirname(path), 'node_modules/pnpm/bin/pnpm.mjs'),
      join(dirname(path), 'node_modules/pnpm/bin/pnpm.cjs'),
      join(dirname(path), 'pnpm.mjs'),
      join(dirname(path), 'pnpm.cjs'),
      join(dirname(path), 'node_modules/corepack/dist/pnpm.js'),
    ]) {
      try {
        await access(entry);
        return { command: process.execPath, args: [entry] };
      } catch {
        /* Try the next standard pnpm shim layout. */
      }
    }
    if (path.endsWith('.exe')) {
      return { command: path, args: [] };
    }
  }
  throw new Error('pnpm 11+ is required. Install pnpm with npm install -g pnpm@11.');
}
