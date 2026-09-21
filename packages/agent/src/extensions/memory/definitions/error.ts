/**
 * @author Codex
 * @description Stable memory errors crossing Agent, terminal and HTTP boundaries.
 */
export class MemoryError extends Error {
  /**
   * Preserve a safe public diagnostic without exposing SQLite or model inputs.
   */
  constructor(
    public readonly code: string,
    message: string,
    options?: { cause: unknown }
  ) {
    super(message, options);
    this.name = 'MemoryError';
  }
}
