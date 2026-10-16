/**
 * @author Codex
 * @description Owns a real native supervisor solely to test cleanup after its Runtime-like parent is terminated.
 */
import { spawn } from 'node:child_process';

const [supervisor, powershell, cwd, script] = process.argv.slice(2);
const child = spawn(supervisor, [powershell, cwd, '--powershell', '30000', String(process.pid), script], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'ignore'],
});
child.stdout.resume();
process.stdout.write(String(child.pid));
setInterval(() => {}, 1000);
