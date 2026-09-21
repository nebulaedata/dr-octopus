/**
 * @author Codex
 * @description Records committed configuration revisions independently of processes and HTTP transport.
 */
import { RESTART_CONFIG_ROUTES } from './config-routes.js';

export class RuntimeConfigChanges {
  private revision = 0;
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  /**
   * Accepts an injectable module list without changing business call sites.
   */
  constructor(private readonly routes: ReadonlySet<string> = RESTART_CONFIG_ROUTES) {}

  /**
   * Returns the process-start baseline without reading configuration files.
   */
  current(): number {
    return this.revision;
  }

  /**
   * Records a known committed mutation before notifying isolated observers.
   */
  record(route: string): void {
    if (!this.routes.has(route)) {
      return;
    }
    this.revisions.set(route, ++this.revision);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot roll back a committed configuration. */
      }
    }
  }

  /**
   * Projects enabled modules changed since a process was started, in declaration order.
   */
  since(baseline: number): string[] {
    return [...this.routes].filter((route) => (this.revisions.get(route) ?? 0) > baseline);
  }

  /**
   * Subscribes a Host-owned bridge and returns its cleanup function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Releases process-local observers during Host shutdown.
   */
  close(): void {
    this.listeners.clear();
  }
}
