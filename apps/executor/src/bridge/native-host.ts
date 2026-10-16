/**
 * @author Codex
 * @description Adapts one fixed browser Native Messaging stream to the existing authenticated Runtime connection endpoint.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  extensionMessageSchema,
  hostMessageSchema,
  bridgeFrameLimit,
} from '@octopus/shared/protocol/browser-bridge';
import { NativeFileCommit } from '../runtime/basic/native-file-commit';
import { readBootstrap } from '../runtime/browser/bridge-store';
import type { BridgeBootstrap } from '../runtime/browser/bridge-store';
import { readFrames, writeFrame } from './native-framing';
import { isBrowserOriginAllowed } from '../../build/browser-identity';

/**
 * Loads only this package's fixed data locator, then validates private bootstrap and actual process login identity.
 */
async function bootstrap(): Promise<BridgeBootstrap> {
  const origin = process.argv[2];
  if (!isBrowserOriginAllowed(origin)) {
    throw new Error('Origin rejected');
  }
  const locationPath = join(__dirname, 'host-location.json');
  const location = z
    .strictObject({ projectRoot: z.string().max(30000).refine(isAbsolute) })
    .parse(JSON.parse(await readFile(locationPath, 'utf8')));
  const native = new NativeFileCommit(join(__dirname, '..', 'native', 'file-commit.node'));
  const root = join(location.projectRoot, 'browser');
  const info = await native.inspect(root);
  if (!info.ok || !info.directory || !info.privateAcl) {
    throw new Error('Private bootstrap unavailable');
  }
  const names = (await readdir(root)).sort();
  if (
    !names.length ||
    names.length > 1000 ||
    names.some((name, index) => name !== `${String(index + 1).padStart(4, '0')}.json`)
  ) {
    throw new Error('Bootstrap history invalid');
  }
  const record = await readBootstrap(native, join(root, names.at(-1)!));
  if (record.loginIdentity !== native.loginIdentity()) {
    throw new Error('Windows login mismatch');
  }
  return record;
}

/**
 * Starts no Runtime and executes no actions; a dead pipe or failed long poll ends this owned connection.
 */
async function main(): Promise<void> {
  const record = await bootstrap();
  const controller = new AbortController();
  let connectionId: string | null = null;
  let writing = Promise.resolve();
  /**
   * Serializes at most one poll and one incoming heartbeat reply without interleaving frame bytes.
   */
  const send = (value: unknown) => {
    writing = writing.then(() => writeFrame(process.stdout, value));
    return writing;
  };
  /**
   * Pins all requests to the bootstrap endpoint with fixed role credentials, finite bytes and no redirects.
   */
  const request = async (method: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(record.endpoint, {
      method,
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      headers: {
        Authorization: `Bearer ${record.credential}`,
        'Content-Type': 'application/json',
        'X-Octopus-Role': 'native-browser-host',
        'X-Octopus-Origin': process.argv[2]!,
        'X-Octopus-Login': record.loginIdentity,
        ...(connectionId ? { 'X-Octopus-Connection': connectionId, 'X-Octopus-Request': randomUUID() } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Empty bridge response');
    }
    let bytes = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) {
          break;
        }
        bytes += part.value.byteLength;
        if (bytes > bridgeFrameLimit) {
          throw new Error('Bridge response too large');
        }
        parts.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const result: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, bytes))
    );
    if (!response.ok && !(response.status === 409 && hostMessageSchema.safeParse(result).success)) {
      throw new Error('Bridge rejected connection');
    }
    return result;
  };
  let polling: Promise<void> | null = null;
  let messages = 0;
  const deadline = setTimeout(() => process.stdin.destroy(new Error('Handshake deadline')), 10000);
  process.stdout.on('error', () => {
    controller.abort();
    process.stdin.destroy();
  });
  try {
    if (!record.enabled) {
      await send({ type: 'error', requestId: null, code: 'DISABLED' });
      return;
    }
    for await (const value of readFrames(process.stdin)) {
      const message = extensionMessageSchema.parse(value);
      if (message.type === 'hello') {
        if (connectionId || polling) {
          throw new Error('Repeated handshake');
        }
        const reply = hostMessageSchema.parse(await request('POST', message));
        await send(reply);
        if (reply.type !== 'connected') {
          return;
        }
        clearTimeout(deadline);
        connectionId = reply.connectionId;
        polling = (async () => {
          while (!controller.signal.aborted) {
            const event = hostMessageSchema.parse(await request('GET'));
            if (
              (event.type !== 'heartbeat' && event.type !== 'request' && event.type !== 'release') ||
              event.connectionId !== connectionId
            ) {
              throw new Error('Stale bridge poll');
            }
            await send(event);
          }
        })().catch(() => {
          controller.abort();
          process.stdin.destroy();
        });
      } else {
        if (message.connectionId !== connectionId || ++messages > 8) {
          throw new Error('Stale or excessive heartbeat');
        }
        if (message.type === 'result') {
          await request('POST', message);
        } else {
          await send(message);
        }
        messages--;
      }
    }
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await polling;
    if (connectionId) {
      // Cleanup has its own deadline because the lifetime controller is already cancelled.
      await fetch(record.endpoint, {
        method: 'DELETE',
        redirect: 'error',
        signal: AbortSignal.timeout(1000),
        headers: {
          Authorization: `Bearer ${record.credential}`,
          'X-Octopus-Role': 'native-browser-host',
          'X-Octopus-Origin': process.argv[2]!,
          'X-Octopus-Login': record.loginIdentity,
          'X-Octopus-Connection': connectionId,
        },
      }).catch(() => {});
    }
    await writing.catch(() => {});
    process.stdin.destroy();
  }
}
void main()
  .catch(() => {
    console.error('[browser-host] Connection ended.');
    process.exitCode = 1;
  })
  .finally(() => {
    process.stdin.destroy();
    const flushing = setTimeout(() => process.stdout.destroy(), 2000);
    flushing.unref();
    process.stdout.end(() => clearTimeout(flushing));
  });
