/**
 * @author Codex
 * @description Correlates bounded Native skill-file requests without retries or exposing a Runtime credential to the extension.
 */
import {
  browserSkillRequestSchema,
  browserSkillResponseSchema,
  type BrowserSkillRequest,
  type BrowserSkillResponse,
} from '@octopus/shared/protocol/browser-skills';

type Command<T> = T extends BrowserSkillRequest ? Omit<T, 'requestId' | 'connectionId'> : never;
export type SkillFileCommand = Command<BrowserSkillRequest>;
type Connection = { id: string; post: (request: BrowserSkillRequest) => void };

export class SkillFileClient {
  private pending = new Map<
    string,
    {
      connectionId: string;
      resolve: (value: BrowserSkillResponse['value']) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * Borrows only the Worker's current authenticated Native connection.
   */
  constructor(private readonly connection: () => Connection | undefined) {}

  /**
   * Reports only the current authenticated Worker connection, not a cached storage label.
   */
  connected(): boolean {
    return Boolean(this.connection());
  }

  /**
   * Sends one request; an unknown save outcome is recovered through its operation receipt, never automatic resubmission.
   */
  request(command: SkillFileCommand): Promise<BrowserSkillResponse['value']> {
    const connection = this.connection();
    if (!connection) {
      return Promise.reject(new Error('SKILL_OFFLINE'));
    }
    if (this.pending.size >= 8) {
      return Promise.reject(new Error('SKILL_BUSY'));
    }
    const request = browserSkillRequestSchema.parse({
      ...command,
      requestId: crypto.randomUUID(),
      connectionId: connection.id,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        reject(new Error('SKILL_FILE_OUTCOME_UNKNOWN'));
      }, 15000);
      this.pending.set(request.requestId, { connectionId: connection.id, resolve, reject, timer });
      try {
        connection.post(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        reject(new Error('SKILL_OFFLINE', { cause: error }));
      }
    });
  }

  /**
   * Accepts a matching current response; a stale connection cannot complete another installation's request.
   */
  receive(value: unknown): boolean {
    const parsed = browserSkillResponseSchema.safeParse(value);
    if (!parsed.success) {
      return false;
    }
    const response = parsed.data;
    const pending = this.pending.get(response.requestId);
    if (!pending || pending.connectionId !== response.connectionId) {
      return true;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.value);
    }
    return true;
  }

  /**
   * Rejects unresolved operations on disconnect without claiming they did not modify files.
   */
  disconnect(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('SKILL_FILE_OUTCOME_UNKNOWN'));
    }
    this.pending.clear();
  }
}
