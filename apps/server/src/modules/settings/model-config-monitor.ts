/**
 * @author Codex
 * @description Reconciles persisted model/auth/default inputs and notifies retained runtimes without exposing credentials.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MODEL_CONFIG_ROUTE } from '../../lib/runtime-config/config-routes.js';
import type { FSWatcher } from 'node:fs';
import type { RuntimeConfigChanges } from '../../lib/runtime-config/runtime-config-changes.js';

/**
 * Missing configuration is the valid empty-install state; other IO and JSON failures stay visible.
 */
async function read(path: string): Promise<string> {
  try {
    const value = await readFile(path, 'utf8');
    try {
      JSON.parse(value);
    } catch {
      throw new Error('Model configuration JSON is invalid.');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '{}';
    }
    throw error;
  }
}
/**
 * Computes a process-independent internal version without logging raw secret-bearing input.
 */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ModelConfigMonitor {
  #models: string | undefined;
  #version = '';
  #pending: Promise<string> | undefined;
  #timer: NodeJS.Timeout | undefined;
  #watcher: FSWatcher | undefined;
  #dirty = false;
  #closed = false;
  /**
   * Keeps dependencies explicit so file events, admission and reconnect share one reconciliation.
   */
  constructor(
    private readonly options: {
      agentDir: string;
      changes: RuntimeConfigChanges;
      /**
       * Refreshes local SDK snapshots.
       */
      refresh(): Promise<void>;
      /**
       * Invalidates browser catalogs after a committed default or model change.
       */
      notify(): void;
      /**
       * Reports reconciliation and native watcher failures to its owning Host.
       */
      onError(error: unknown): void;
    }
  ) {}
  /**
   * Shares a coherent read; failures leave the previous baseline intact for retry.
   */
  refresh(): Promise<string> {
    this.#pending ??= (async () => {
      for (let pass = 0; pass < 4; pass++) {
        this.#dirty = false;
        const version = await this.#refresh();
        if (!this.#dirty || this.#closed) {
          return version;
        }
      }
      throw new Error('Configuration kept changing during reconciliation.');
    })().finally(() => {
      this.#pending = undefined;
      if (this.#dirty && !this.#closed) {
        this.invalidate();
      }
    });
    return this.#pending;
  }
  /**
   * Rechecks the files after refresh so a concurrent save cannot be certified with the wrong snapshot.
   */
  async #refresh(): Promise<string> {
    const [models, auth, settings] = await Promise.all(
      ['models.json', 'auth.json', 'settings.json'].map((file) => read(join(this.options.agentDir, file)))
    );
    const parsed = JSON.parse(settings!) as Record<string, unknown>;
    const modelVersion = digest([models, auth]);
    const version = digest([modelVersion, parsed['defaultProvider'], parsed['defaultModel']]);
    if (version !== this.#version) {
      await this.options.refresh();
      const confirmed = await Promise.all(
        ['models.json', 'auth.json', 'settings.json'].map((file) => read(join(this.options.agentDir, file)))
      );
      if (confirmed[0] !== models || confirmed[1] !== auth || confirmed[2] !== settings) {
        throw new Error('Configuration changed while its catalog was refreshing.');
      }
      if (this.#models !== undefined && modelVersion !== this.#models) {
        this.options.changes.record(MODEL_CONFIG_ROUTE);
      }
      this.#models = modelVersion;
      this.#version = version;
      this.options.notify();
    }
    return version;
  }
  /**
   * Coalesces actual committed writes and native file events, including events during a refresh.
   */
  invalidate(): void {
    if (this.#closed) {
      return;
    }
    this.#dirty = true;
    this.#timer ??= setTimeout(() => {
      this.#timer = undefined;
      void this.refresh().catch((error) => this.options.onError(error));
    }, 100);
    this.#timer.unref();
  }
  /**
   * Watches the directory before taking the initial snapshot, preserving atomic file replacement events.
   */
  async start() {
    await mkdir(this.options.agentDir, { recursive: true });
    if (this.#closed) {
      return;
    }
    this.#watcher = watch(this.options.agentDir, { persistent: false }, (_event, filename) => {
      if (filename === null || ['models.json', 'auth.json', 'settings.json'].includes(filename.toString())) {
        this.invalidate();
      }
    });
    this.#watcher.on('error', (error) => this.options.onError(error));
    await this.refresh();
  }
  /**
   * Stops native subscriptions and pending debounce work before Settings infrastructure shuts down.
   */
  async close() {
    this.#closed = true;
    const watcher = this.#watcher;
    this.#watcher = undefined;
    const stopped = watcher
      ? new Promise<void>((resolve) => watcher.once('close', resolve))
      : Promise.resolve();
    watcher?.close();
    clearTimeout(this.#timer);
    await Promise.all([stopped, this.#pending?.catch(() => undefined)]);
  }
}
