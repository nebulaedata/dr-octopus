/**
 * @author Codex
 * @description Exercise the production guard with controlled native results before a harmless entry marker.
 */
import { writeFile } from 'node:fs/promises';
import { windowsNative as win } from '../../dist/lib/daemon-platform/windows-native.js';
const [scenario, marker] = process.argv.slice(2);
win.isInJob = (_process, _job, result) => {
  result[0] = scenario === 'no-job' ? 0 : 1;
  return scenario === 'membership-failure' ? 0 : 1;
};
win.currentJobLimitFlags = () => (scenario === 'query-failure' ? undefined : Number(scenario));
await import('../../dist/lib/daemon-platform/windows-broker-guard.js');
await writeFile(
  marker,
  JSON.stringify({
    receipt: process.env.OCTOPUS_PROCESS_LAUNCH_RECEIPT,
    nonce: process.env.OCTOPUS_PROCESS_LAUNCH_NONCE,
    user: process.env.OCTOPUS_PROCESS_LAUNCH_USER,
  })
);
