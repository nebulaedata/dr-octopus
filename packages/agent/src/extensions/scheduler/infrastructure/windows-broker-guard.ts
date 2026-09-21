/**
 * @author Codex
 * @description Verify a broker-created process before Node loads the scheduler business entry.
 */
import { writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { windowsNative as win } from './windows-native.js';

const receipt = process.env.OCTOPUS_SCHEDULER_LAUNCH_RECEIPT;
const nonce = process.env.OCTOPUS_SCHEDULER_LAUNCH_NONCE;
const expectedUser = process.env.OCTOPUS_SCHEDULER_LAUNCH_USER;
delete process.env.OCTOPUS_SCHEDULER_LAUNCH_RECEIPT;
delete process.env.OCTOPUS_SCHEDULER_LAUNCH_NONCE;
delete process.env.OCTOPUS_SCHEDULER_LAUNCH_USER;

const inJob = [0];
const valid =
  receipt !== undefined &&
  nonce !== undefined &&
  userInfo().username === expectedUser &&
  win.isInJob(win.currentProcess(), null, inJob) !== 0 &&
  inJob[0] === 0;
if (!valid) {
  // Exit before the requested entry can acquire locks, create tasks or execute tools.
  process.exit(1);
}
await writeFile(receipt, JSON.stringify({ nonce, pid: process.pid }), { flag: 'wx', mode: 0o600 });
