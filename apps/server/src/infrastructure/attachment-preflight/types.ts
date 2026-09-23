/**
 * @author Codex
 * @description Defines the read-only source contract shared by format preflight inspectors.
 */

export interface PreflightSource {
  readonly path: string;
  /**
   * Opens a fresh stream; optional byte bounds are inclusive. The caller consumes the stream.
   */
  openRead(range?: { start: number; end: number }): Promise<{ stream: AsyncIterable<Uint8Array> }>;
}
