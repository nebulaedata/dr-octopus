/**
 * @author Codex
 * @description Stable knowledge errors crossing storage, model, IPC and Host boundaries.
 */
export class KnowledgeError extends Error {
  /**
   * Carry a safe public message without exposing provider responses or credentials.
   */
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'KnowledgeError';
  }
}
