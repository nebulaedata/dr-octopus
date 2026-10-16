/**
 * @author Codex
 * @description Owns one fixed private Computer connection with merged startup and bounded cleanup, without activating production tool admission.
 */
import { isAbsolute, join } from 'node:path';
import { ComputerStdioTransport } from './computer-stdio-transport';
import { WindowsMcpConnection } from './windows-mcp-connection';

export class ComputerBackend {
  private readonly abort = new AbortController();
  private pending: Promise<WindowsMcpConnection> | undefined;
  private connection: WindowsMcpConnection | undefined;
  private stopping: Promise<{ executionStopConfirmed: boolean }> | undefined;

  /**
   * Accepts only an absolute, trusted Host-selected resource root, never a Renderer or MCP command.
   */
  constructor(private readonly root: string) {
    if (!isAbsolute(root)) {
      throw new Error('COMPUTER_RESOURCE_PATH_REJECTED');
    }
  }

  /**
   * Coalesces concurrent startup into one fixed Job-supervised stdio transport.
   */
  connect(): Promise<WindowsMcpConnection> {
    if (this.stopping) {
      return Promise.reject(new Error('COMPUTER_BACKEND_CLOSED'));
    }
    if (this.connection && !this.connection.supportsProductContract()) {
      return Promise.reject(new Error('COMPUTER_BACKEND_DISCONNECTED'));
    }
    this.pending ??= this.start();
    return this.pending;
  }

  /**
   * Cancels handshake, waits for any acquired owner and never turns failed cleanup into a positive stop result.
   */
  close(): Promise<{ executionStopConfirmed: boolean }> {
    this.abort.abort();
    this.stopping ??= this.stop();
    return this.stopping;
  }

  /**
   * Uses a minimal environment and fixed private paths; there is no system Python, download or automatic retry fallback.
   */
  private async start(): Promise<WindowsMcpConnection> {
    this.abort.signal.throwIfAborted();
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !isAbsolute(systemRoot)) {
      throw new Error('COMPUTER_ENVIRONMENT_UNAVAILABLE');
    }
    const resource = join(this.root, 'resources/computer');
    const transport = new ComputerStdioTransport(
      join(this.root, 'native/computer-supervisor.exe'),
      join(resource, 'python.exe'),
      resource,
      ['-I', '-B', '-u', '-m', 'product.server'],
      { SystemRoot: systemRoot, ANONYMIZED_TELEMETRY: 'false', WINDOWS_MCP_WATCHDOG: 'false' }
    );
    this.connection = await WindowsMcpConnection.connect(
      { transport: 'stdio' },
      {
        openLocal: async () => ({ transport, stop: () => transport.close() }),
      },
      this.abort.signal
    );
    if (!this.connection.supportsProductContract()) {
      await this.connection.close();
      throw new Error('COMPUTER_PRODUCT_CONTRACT_MISMATCH');
    }
    return this.connection;
  }

  /**
   * A startup error is already cleaned by the connection boundary; unconfirmed tree cleanup remains an error.
   */
  private async stop(): Promise<{ executionStopConfirmed: boolean }> {
    if (this.pending) {
      try {
        await this.pending;
      } catch (error) {
        if (error instanceof Error && error.message === 'WINDOWS_MCP_CLEANUP_UNCONFIRMED') {
          throw error;
        }
      }
    }
    return this.connection ? this.connection.close() : { executionStopConfirmed: true };
  }
}

/**
 * Builds the future Runtime's owner from its fixed resource root without resource preflight.
 */
export function createComputerBackend(resourceRoot: string): ComputerBackend {
  return new ComputerBackend(resourceRoot);
}
