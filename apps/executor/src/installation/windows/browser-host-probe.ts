/**
 * @author Codex
 * @description Verifies a staged Host with a bounded read-only nonce exchange, without creating a browser tool installation or replaying actions.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bridgeVersion, hostMessageSchema } from '@octopus/shared/protocol/browser-bridge';
import { readFrames, writeFrame } from '../../bridge/native-framing';
import type { HostProbeOutcome } from '../../maintenance/browser-host';

/**
 * Owns the launcher until exit; its Job contains all private Node descendants, including on timeout.
 */
export async function probeBrowserHost(
  directory: string,
  bundleId: string,
  origins: readonly string[]
): Promise<HostProbeOutcome> {
  const child = spawn(join(directory, 'native/browser-launcher.exe'), [origins[0]!], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  let pipeFailed = false;
  child.stdin.on('error', () => {
    pipeFailed = true;
  });
  child.stderr.resume();
  const closed = new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null));
    child.once('close', resolve);
  });
  const deadline = setTimeout(() => child.kill(), 10000);
  const requestId = randomUUID();
  const nonce = randomUUID();
  const frames = readFrames(child.stdout);
  let state: HostProbeOutcome['state'] = 'failed';
  try {
    const received = frames.next().catch(() => null);
    await writeFrame(child.stdin, { type: 'probe', requestId, nonce, version: bridgeVersion }).catch(() => {
      pipeFailed = true;
    });
    const next = await received;
    const reply = hostMessageSchema.safeParse(next?.value);
    if (
      reply.success &&
      reply.data.type === 'probe-result' &&
      reply.data.requestId === requestId &&
      reply.data.nonce === nonce &&
      reply.data.hostBundleId === bundleId
    ) {
      state = 'ready';
    } else if (
      reply.success &&
      reply.data.type === 'error' &&
      ['DISABLED', 'RUNTIME_OFFLINE', 'HOST_BOOTSTRAP_UNAVAILABLE'].includes(reply.data.code)
    ) {
      state = 'waiting';
    }
  } catch {
    state = 'failed';
  } finally {
    if (!pipeFailed) {
      child.stdin.end();
    }
    child.stdout.resume();
  }
  const exitCode = await closed;
  clearTimeout(deadline);
  await frames.return(undefined);
  if (exitCode === null || (state === 'ready' && exitCode !== 0)) {
    state = 'failed';
  }
  return { state, exitCode };
}
