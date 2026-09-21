/**
 * @author Codex
 * @description Holds the Gateway singleton for its process lifetime and authenticates local lifecycle requests.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { readGatewayIdentity } from './client.js';
import { gatewayError, gatewayPaths } from './protocol.js';
import { acquireLease } from './lease.js';
import type { GatewayPaths, GatewayStatus } from './protocol.js';

/**
 * Acquires an OS-exclusive pipe/socket before startup touches any application resources.
 * A live or ambiguous historical identity is never reclaimed based on health alone.
 */
export async function acquireGateway(
  entryPath: string,
  version: string,
  onStop: (force: boolean) => void,
  paths: GatewayPaths = gatewayPaths()
) {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    await chmod(paths.directory, 0o700);
  }
  const releaseLease = acquireLease(`${paths.record}.lock`);
  const identity = {
    instanceId: randomUUID(),
    token: randomBytes(32).toString('hex'),
    pid: process.pid,
    startedAt: new Date().toISOString(),
    nodePath: process.execPath,
    entryPath,
    version,
  };
  const { token, ...publicIdentity } = identity;
  const status: GatewayStatus = { ...publicIdentity, state: 'starting', phase: 'bootstrap', warnings: [] };
  const control = createServer((socket) => {
    let body = '';
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 4096) {
        socket.destroy();
        return;
      }
      if (!body.includes('\n')) {
        return;
      }
      try {
        const request = JSON.parse(body) as { token?: string; instanceId?: string; action?: string };
        if (
          request.token !== token ||
          request.instanceId !== identity.instanceId ||
          !['status', 'stop', 'force'].includes(request.action ?? '')
        ) {
          socket.destroy();
          return;
        }
        owner.refresh();
        socket.end(JSON.stringify(status));
        if (request.action !== 'status') {
          status.state = 'stopping';
          setImmediate(() => onStop(request.action === 'force'));
        }
      } catch {
        socket.destroy();
      }
    });
  });
  try {
    await readGatewayIdentity(paths);
    if (process.platform !== 'win32') {
      await unlink(paths.endpoint).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }
    await new Promise<void>((resolve, reject) => {
      control.once('error', reject);
      control.listen({ path: paths.endpoint, exclusive: true }, () => {
        control.removeListener('error', reject);
        resolve();
      });
    });
    const temporary = `${paths.record}.${identity.instanceId}`;
    await writeFile(temporary, JSON.stringify(identity), { mode: 0o600 });
    await rename(temporary, paths.record);
  } catch (error) {
    control.close();
    releaseLease();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw gatewayError('GATEWAY_ALREADY_RUNNING', 'Another Gateway owns the local control endpoint.');
    }
    throw error;
  }
  const owner = {
    status,
    /**
     * Refreshes runtime-derived diagnostics immediately before sending a status snapshot.
     */
    refresh(): void {},
    /**
     * Releases only this instance's record after the Gateway has closed its hosted resources.
     */
    async close(): Promise<void> {
      const current = await readGatewayIdentity(paths);
      if (current?.instanceId === identity.instanceId) {
        await unlink(paths.record);
      }
      await new Promise<void>((resolve, reject) =>
        control.close((error) => (error ? reject(error) : resolve()))
      );
      releaseLease();
    },
  };
  return owner;
}
