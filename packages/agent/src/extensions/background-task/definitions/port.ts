/**
 * @author Codex
 * @description Defines the process ownership boundary used by the session task manager.
 */
export interface ManagedProcess {
  /**
   * Resolves only when the managed process scope is empty and output has drained.
   */
  done: Promise<{ exitCode: number | null }>;
  /**
   * Requests termination of the entire owned scope, escalating where supported.
   */
  stop(): void;
}

export interface ProcessLauncher {
  /**
   * Establishes ownership before running user code; failures leave no launched user command.
   */
  launch(command: string, cwd: string, onData: (data: Buffer) => void): Promise<ManagedProcess>;
}
