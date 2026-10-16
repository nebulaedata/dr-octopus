/**
 * @author Codex
 * @description Bounds Main confirmation of painted local execution feedback without accepting Renderer claims or replaying input.
 */
import { computerIndicatorReplySchema } from '../../contracts/computer-use';

export class ComputerIndicatorConfirmation {
  private readonly pending = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private closed = false;

  /**
   * Waits for an exact revision once; duplicates, absent Host evidence and shutdown never permit input dispatch.
   */
  wait(revision: number): Promise<void> {
    if (this.closed || this.pending.has(revision) || this.pending.size >= 32) {
      return Promise.reject(new Error('COMPUTER_INDICATOR_UNAVAILABLE'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(revision);
        reject(new Error('COMPUTER_INDICATOR_TIMEOUT'));
      }, 3000);
      this.pending.set(revision, { resolve, reject, timer });
    });
  }

  /**
   * Consumes only the strict parent-channel reply schema; old and duplicate revisions cannot release a newer call.
   */
  receive(message: unknown): boolean {
    const result = computerIndicatorReplySchema.safeParse(message);
    if (!result.success) {
      return false;
    }
    const pending = this.pending.get(result.data.revision);
    if (pending) {
      this.pending.delete(result.data.revision);
      clearTimeout(pending.timer);
      if (result.data.visible) {
        pending.resolve();
      } else {
        pending.reject(new Error('COMPUTER_INDICATOR_UNAVAILABLE'));
      }
    }
    return true;
  }

  /**
   * Rejects all owned waits during Runtime shutdown; idempotent cleanup cannot forge a visible indicator.
   */
  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('COMPUTER_INDICATOR_UNAVAILABLE'));
    }
    this.pending.clear();
  }
}
