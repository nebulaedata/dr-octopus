/**
 * @author Codex
 * @description Defines transport-independent lifecycle and diagnostic contracts for Server hosts.
 */
export interface ServerStatus {
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  phase: 'bootstrap' | 'infra' | 'extensions' | 'listen' | 'ready';
  address?: string;
  dataDir: string;
  fileLogging: { enabled: boolean; state: string; directory: string };
  warnings: string[];
}

export interface ServerRuntime {
  /**
   * Initializes resources and listens once. Rejects on failure or cancellation; failure closes resources.
   */
  start(): Promise<void>;
  /**
   * Cancels startup, waits for initialization to settle, and closes owned resources exactly once.
   */
  close(): Promise<void>;
  /**
   * Returns a detached diagnostic snapshot without exposing mutable lifecycle state.
   */
  getStatus(): ServerStatus;
}
