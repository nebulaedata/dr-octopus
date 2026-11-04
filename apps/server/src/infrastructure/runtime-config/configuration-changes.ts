/**
 * @author Codex
 * @description Owns process-local configuration versions and isolated commit subscriptions.
 */
import { configurationCatalog } from './configuration-catalog.js';
import type { ConfigurationCategory, ConfigurationScope } from './configuration-catalog.js';
export class ConfigurationChanges {
  private revision = 0;
  private readonly global = new Map<ConfigurationCategory, number>();
  private readonly workspaces = new Map<string, Map<ConfigurationCategory, number>>();
  private readonly listeners = new Set<() => void>();
  private closed = false;
  private readonly reported = new Set<string>();
  /**
   * Receives a bounded diagnostic sink; configuration values never enter diagnostics.
   */
  constructor(private readonly diagnostic: (code: string) => void = () => undefined) {}
  /**
   * Binds a global publisher during module composition.
   */
  publisher(category: Exclude<ConfigurationCategory, 'skills'>): () => void;
  /**
   * Binds a publisher requiring the trusted Skill scope.
   */
  publisher(category: 'skills'): (scope: ConfigurationScope) => void;
  /**
   * Records commits synchronously before notifying observers.
   */
  publisher(category: ConfigurationCategory): (scope?: ConfigurationScope) => void {
    if (this.closed || !Object.hasOwn(configurationCatalog, category)) {
      throw new Error('Configuration publisher is unavailable.');
    }
    return (scope = { kind: 'global' }) => {
      if (this.closed) {
        this.report('publish-after-close');
        return;
      }
      if (scope.kind === 'workspace' && (category !== 'skills' || !scope.workspaceId)) {
        this.report('invalid-configuration-scope');
        return;
      }
      let revisions = this.global;
      if (scope.kind === 'workspace') {
        revisions = this.workspaces.get(scope.workspaceId) ?? new Map<ConfigurationCategory, number>();
        this.workspaces.set(scope.workspaceId, revisions);
      }
      revisions.set(category, ++this.revision);
      for (const listener of [...this.listeners]) {
        try {
          listener();
        } catch {
          this.report('configuration-observer-failed');
        }
      }
    };
  }
  /**
   * Reads the startup baseline without activating resources.
   */
  current(): number {
    return this.revision;
  }
  /**
   * Returns global and matching Workspace changes in declaration order.
   */
  since(baseline: number, workspaceId?: string): ConfigurationCategory[] {
    const local = workspaceId === undefined ? undefined : this.workspaces.get(workspaceId);
    return (Object.keys(configurationCatalog) as ConfigurationCategory[]).filter(
      (category) => Math.max(this.global.get(category) ?? 0, local?.get(category) ?? 0) > baseline
    );
  }
  /**
   * Subscribes synchronously and returns an idempotent cancellation handle.
   */
  subscribe(listener: () => void): () => void {
    if (this.closed) {
      throw new Error('Configuration changes are closed.');
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * Releases observers; previously bound publishers become inert.
   */
  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
  /**
   * Reports each bounded failure category once without affecting commits.
   */
  private report(code: string): void {
    if (this.reported.has(code)) {
      return;
    }
    this.reported.add(code);
    try {
      this.diagnostic(code);
    } catch {
      /* Diagnostics cannot change committed state. */
    }
  }
}
