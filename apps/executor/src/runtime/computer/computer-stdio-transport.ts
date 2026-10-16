/**
 * @author Codex
 * @description Carries bounded MCP stdio through the product's Job supervisor and accepts tree cleanup only from its owned native exit status.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export class ComputerStdioTransport implements Transport {
  onmessage?: Transport['onmessage'];
  onerror?: Transport['onerror'];
  onclose?: Transport['onclose'];
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly reader = new ReadBuffer({ maxBufferSize: 24 * 1024 * 1024 });
  private exit: Promise<boolean> | undefined;
  private closing: Promise<void> | undefined;
  private sent = 0;
  private started = false;
  private closed = false;

  /**
   * Receives only trusted Host paths and fixed args; this contract is never exposed through MCP or Renderer IPC.
   */
  constructor(
    private readonly supervisor: string,
    private readonly executable: string,
    private readonly cwd: string,
    private readonly args: readonly string[],
    private readonly environment: Record<string, string>
  ) {}

  /**
   * Launches once with exact argv, a minimal environment and no shell; the native owner assigns the backend before resuming it.
   */
  async start(): Promise<void> {
    if (this.started || this.closed) {
      throw new Error('COMPUTER_TRANSPORT_UNAVAILABLE');
    }
    this.started = true;
    const child = spawn(this.supervisor, [this.executable, this.cwd, String(process.pid), ...this.args], {
      cwd: this.cwd,
      env: this.environment,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.exit = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        this.closed = true;
        this.reader.clear();
        // A rejected spawn has no PID and therefore never acquired an executable process or Job.
        resolve(child.pid === undefined || (code === 0 && signal === null));
        this.onclose?.();
      });
    });
    // Drain private diagnostics so a full stderr pipe cannot block the owned backend.
    child.stderr.resume();
    child.stdin.on('error', () => this.fail());
    child.stdout.on('error', () => this.fail());
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.reader.append(chunk);
        let message: JSONRPCMessage | null;
        while ((message = this.reader.readMessage()) !== null) {
          this.onmessage?.(message);
        }
      } catch {
        this.fail();
      }
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => {
        this.onerror?.(new Error('COMPUTER_TRANSPORT_FAILED'));
        reject(new Error('COMPUTER_TRANSPORT_FAILED'));
      });
    });
  }

  /**
   * Limits serialized requests and outstanding writes; native pipes and Node callbacks propagate real backpressure.
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child || this.closed || this.closing || this.sent >= 32) {
      throw new Error('COMPUTER_TRANSPORT_UNAVAILABLE');
    }
    const bytes = serializeMessage(message);
    if (Buffer.byteLength(bytes) > 256 * 1024) {
      throw new Error('COMPUTER_REQUEST_LIMIT');
    }
    this.sent++;
    try {
      await new Promise<void>((resolve, reject) =>
        this.child!.stdin.write(bytes, (error) =>
          error ? reject(new Error('COMPUTER_TRANSPORT_FAILED')) : resolve()
        )
      );
    } finally {
      this.sent--;
    }
  }

  /**
   * Ends stdin to ask the supervisor to clean its whole Job; forced termination or a nonzero exit cannot confirm cleanup.
   */
  close(): Promise<void> {
    if (this.closing) {
      return this.closing;
    }
    this.closing = this.stop();
    return this.closing;
  }

  /**
   * Requires the native owner's successful exit after a real spawn; a rejected spawn owns no process to stop.
   */
  private async stop(): Promise<void> {
    this.closed = true;
    if (!this.child || !this.exit) {
      return;
    }
    this.child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const confirmed = await Promise.race([
        this.exit,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => {
            this.child?.kill();
            resolve(false);
          }, 2500);
        }),
      ]);
      if (!confirmed) {
        throw new Error('WINDOWS_MCP_CLEANUP_UNCONFIRMED');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Invalidates a broken stream and initiates owned cleanup without exposing child diagnostics or replaying requests.
   */
  private fail(): void {
    this.onerror?.(new Error('COMPUTER_TRANSPORT_FAILED'));
    void this.close().catch(() => {
      this.onerror?.(new Error('WINDOWS_MCP_CLEANUP_UNCONFIRMED'));
    });
  }
}
