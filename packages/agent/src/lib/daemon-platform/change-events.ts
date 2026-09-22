/**
 * @author Codex
 * @description Publishes bounded authenticated daemon invalidations without exposing domain data or retaining snapshots.
 */
import type { ServerResponse } from 'node:http';

export class DaemonChangeEvents {
  readonly #clients = new Set<ServerResponse>();
  #revision = 0;
  #queued = false;
  #heartbeat: NodeJS.Timeout | undefined;
  /**
   * Registers a stream before its ready frame so a concurrent mutation cannot be missed.
   */
  attach(response: ServerResponse): void {
    if (this.#clients.size >= 64) {
      response.writeHead(503);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    this.#clients.add(response);
    response.once('error', () => response.destroy());
    response.once('close', () => {
      this.#clients.delete(response);
      if (!this.#clients.size) {
        clearInterval(this.#heartbeat);
        this.#heartbeat = undefined;
      }
    });
    this.#write(response, `event: ready\ndata: {"revision":${this.#revision}}\n\n`);
    this.#heartbeat ??= setInterval(() => {
      for (const client of this.#clients) {
        this.#write(client, ': heartbeat\n\n');
      }
    }, 15000);
    this.#heartbeat.unref();
  }
  /**
   * Defers delivery until synchronous transactions have committed; failed work only causes a harmless re-read.
   */
  changed(): void {
    if (this.#queued) {
      return;
    }
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      const frame = `event: change\ndata: {"revision":${++this.#revision}}\n\n`;
      for (const client of this.#clients) {
        this.#write(client, frame);
      }
    });
  }
  /**
   * Disconnects slow consumers instead of accumulating unbounded business notifications.
   */
  #write(response: ServerResponse, frame: string): void {
    try {
      if (response.destroyed || !response.write(frame)) {
        response.destroy();
      }
    } catch {
      response.destroy();
    }
  }
  /**
   * Releases streams before the daemon waits for HTTP shutdown.
   */
  close(): void {
    clearInterval(this.#heartbeat);
    for (const client of this.#clients) {
      client.end();
    }
    this.#clients.clear();
  }
}
