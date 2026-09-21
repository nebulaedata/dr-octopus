/**
 * @author Codex
 * @description Streams coalesced Scheduler invalidations with bounded per-consumer memory.
 */
import type { ServerResponse } from 'node:http';

/**
 * Compare committed observations at existing operation boundaries, never start a polling timer.
 */
export class SchedulerChangeStream {
  private readonly connections = new Set<ServerResponse>();
  private previous: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  /**
   * Inject a cheap observation of committed database changes and semantic worker diagnostics.
   */
  constructor(private readonly observe: () => string) {
    this.previous = observe();
  }

  /**
   * Called after synchronous work or a control response; unchanged scheduler scans emit nothing.
   */
  changed(force = false): void {
    if (this.closed) {
      return;
    }
    let next: string;
    try {
      next = this.observe();
    } catch {
      return;
    }
    if (!force && next === this.previous) {
      return;
    }
    this.previous = next;
    if (!this.connections.size || this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const response of this.connections) {
        this.write(response, 'event: change\ndata: {}\n\n');
      }
    }, 100);
    this.timer.unref();
  }

  /**
   * Attach only after the lifecycle transport validates control credentials and daemon identity.
   */
  connect(response: ServerResponse): void {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    this.connections.add(response);
    const heartbeat = setInterval(() => this.write(response, ': heartbeat\n\n'), 15_000);
    heartbeat.unref();
    response.once('close', () => {
      clearInterval(heartbeat);
      this.connections.delete(response);
    });
    response.on('error', () => response.destroy());
    this.write(response, 'event: ready\ndata: {}\n\n');
  }

  /**
   * Release streams before closing the HTTP listener or backing database.
   */
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    for (const response of this.connections) {
      response.destroy();
    }
    this.connections.clear();
  }

  /**
   * Drop slow consumers; the SDK reconnects and requests a fresh authoritative snapshot.
   */
  private write(response: ServerResponse, frame: string): void {
    try {
      if (!response.destroyed && response.write(frame)) {
        return;
      }
    } catch {
      /* Closing the connection is sufficient; ready repairs the lost hint. */
    }
    this.connections.delete(response);
    response.destroy();
  }
}
