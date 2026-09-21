/**
 * @author Codex
 * @description Verify a broker-created process before Node loads the daemon business entry.
 */
import { writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { windowsNative as win } from './windows-native.js';
import { permitsBrokerJob } from './windows-broker-policy.js';

const receipt = process.env.OCTOPUS_PROCESS_LAUNCH_RECEIPT;
const nonce = process.env.OCTOPUS_PROCESS_LAUNCH_NONCE;
const expectedUser = process.env.OCTOPUS_PROCESS_LAUNCH_USER;
delete process.env.OCTOPUS_PROCESS_LAUNCH_RECEIPT;
delete process.env.OCTOPUS_PROCESS_LAUNCH_NONCE;
delete process.env.OCTOPUS_PROCESS_LAUNCH_USER;

let error: string | undefined;
if (receipt === undefined || nonce === undefined) {
  process.exit(1);
}
if (userInfo().username !== expectedUser) {
  error = 'Broker process user did not match the launcher';
} else {
  const inJob = [0];
  if (!win.isInJob(win.currentProcess(), null, inJob)) {
    error = 'Broker process Job membership could not be verified';
  } else if (inJob[0] !== 0) {
    const flags = win.currentJobLimitFlags();
    if (!permitsBrokerJob(flags)) {
      error =
        flags === undefined
          ? 'Broker process Job limits could not be queried'
          : `Broker process has unsupported Job limits (0x${flags.toString(16)})`;
    }
  }
}
await writeFile(receipt, JSON.stringify({ nonce, pid: process.pid, ...(error ? { error } : {}) }), {
  flag: 'wx',
  mode: 0o600,
});
if (error) {
  // Reject before Node loads business code, but leave a receipt explaining the failure.
  process.exit(1);
}
