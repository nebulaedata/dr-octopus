/**
 * @author Codex
 * @description Persists agent revisions and recording-to-skill bindings with transaction-owned compare-and-swap updates.
 */
import { browserSkillPackageSchema } from '@octopus/shared/protocol/browser-skills';
import { cacheSkill, readSkillCache, type SkillCache } from '../skill-library/skill-snapshot';
import {
  skillDeletionBlock,
  answerSkillSession,
  completeSkillTool,
  skillToolResult,
  type SkillSession,
} from './skill-session';

export type RecordingSkillBinding = {
  recordingId: string;
  skillId: string;
  definitionHash: string;
  sessionId: string;
  savedAt: number;
  storage: 'browser' | 'executor';
  cache?: SkillCache;
  diskSave?: { pending: boolean; error?: string };
};

/**
 * Deletes the retired pre-release workflow database without reading or converting its records.
 * A live legacy connection must close before IndexedDB can complete deletion.
 */
export function deleteRetiredWorkflowDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('octopus-workflows');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('SKILL_STORAGE', { cause: request.error }));
    request.onblocked = () => reject(new Error('SKILL_STORAGE_BLOCKED'));
  });
}

export class SkillSessionRepository {
  private connection?: Promise<IDBDatabase>;

  /**
   * Opens current session storage and discards explicitly retired pre-release history during the schema upgrade.
   */
  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('octopus-skill-sessions', 4);
      request.onupgradeneeded = (event) => {
        if (!request.result.objectStoreNames.contains('sessions')) {
          request.result
            .createObjectStore('sessions', { keyPath: 'id' })
            .createIndex('recording', 'recordingId');
        }
        if (!request.result.objectStoreNames.contains('bindings')) {
          request.result.createObjectStore('bindings', { keyPath: 'recordingId' });
        }
        if (request.result.objectStoreNames.contains('migrations')) {
          request.result.deleteObjectStore('migrations');
        }
        if (event.oldVersion > 0 && event.oldVersion < 4) {
          const bindings = request.transaction!.objectStore('bindings').openCursor();
          bindings.onsuccess = () => {
            const row = bindings.result;
            if (!row) {
              return;
            }
            const binding = { ...row.value, storage: 'executor' } as RecordingSkillBinding;
            if (typeof binding.sessionId !== 'string') {
              row.update(binding);
              row.continue();
              return;
            }
            const original = request.transaction!.objectStore('sessions').get(binding.sessionId);
            original.onsuccess = () => {
              const candidate = browserSkillPackageSchema.safeParse(original.result?.candidate);
              if (candidate.success) {
                binding.cache = cacheSkill(
                  {
                    skillId: binding.skillId,
                    definitionHash: binding.definitionHash,
                    candidate: candidate.data,
                  },
                  binding.savedAt
                );
              }
              row.update(binding);
              row.continue();
            };
          };
        }
        const cursor = request.transaction!.objectStore('sessions').openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) {
            return;
          }
          if (Object.hasOwn(row.value, 'historical')) {
            row.delete();
          }
          row.continue();
        };
      };
      request.onerror = () => {
        this.connection = undefined;
        reject(new Error('SKILL_STORAGE', { cause: request.error }));
      };
      request.onblocked = () => {
        this.connection = undefined;
        reject(new Error('SKILL_STORAGE_BLOCKED'));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.connection = undefined;
        };
        resolve(db);
      };
    });
    return this.connection;
  }

  /**
   * Creates one task only after durable commit; duplicate task identities fail rather than overwrite.
   */
  async create(
    session: SkillSession,
    expectedSkill?: { skillId: string; contentHash: string }
  ): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(expectedSkill ? ['sessions', 'bindings'] : ['sessions'], 'readwrite');
      let failure: unknown;
      const add = () => {
        try {
          tx.objectStore('sessions').add(session);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      if (expectedSkill) {
        const request = tx.objectStore('bindings').get(session.recordingId);
        request.onsuccess = () => {
          const binding = request.result as RecordingSkillBinding | undefined;
          if (
            !binding ||
            binding.skillId !== expectedSkill.skillId ||
            binding.cache?.contentHash !== expectedSkill.contentHash
          ) {
            failure = new Error('SKILL_SESSION_STALE');
            tx.abort();
            return;
          }
          add();
        };
      } else {
        add();
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure ?? new Error('SKILL_STORAGE', { cause: tx.error }));
    });
  }

  /**
   * Deletes the confirmed session and optionally its own binding, never a newer generated skill.
   */
  async remove(id: string, revision: number, epoch: string, deleteSkill = false): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'bindings'], 'readwrite');
      const store = tx.objectStore('sessions');
      const request = store.get(id);
      let failure: unknown;
      request.onsuccess = () => {
        const session = request.result as SkillSession | undefined;
        if (!session) {
          return;
        }
        try {
          if (session.revision !== revision || session.epoch !== epoch) {
            throw Error('SKILL_SESSION_STALE');
          }
          if (skillDeletionBlock(session)) {
            throw Error('SKILL_DELETE_BLOCKED');
          }
          if (deleteSkill) {
            if (session.mode !== 'organize' || !session.operationId) {
              throw Error('SKILL_INVALID');
            }
            const bindings = tx.objectStore('bindings');
            const binding = bindings.get(session.recordingId);
            binding.onsuccess = () => {
              if (binding.result?.skillId === session.operationId && binding.result?.sessionId === id) {
                bindings.delete(session.recordingId);
              }
            };
          }
          store.delete(id);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure ?? new Error('SKILL_STORAGE', { cause: tx.error }));
    });
  }

  /**
   * Reads one immutable structured clone; callers cannot mutate the stored task outside CAS.
   */
  async get(id: string): Promise<SkillSession | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('sessions').objectStore('sessions').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('SKILL_STORAGE', { cause: request.error }));
    });
  }

  /**
   * Returns task history for one recording without exposing a different recording's payload.
   */
  async list(recordingId?: string): Promise<SkillSession[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const store = db.transaction('sessions').objectStore('sessions');
      const request = recordingId ? store.index('recording').getAll(recordingId) : store.getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as SkillSession[]).sort(
            (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)
          )
        );
      request.onerror = () => reject(new Error('SKILL_STORAGE', { cause: request.error }));
    });
  }

  /**
   * Applies a synchronous domain mutation in the read transaction; only its committed revision is returned.
   * Returning false is a verified idempotent receipt and does not advance the revision.
   */
  async update(
    id: string,
    expectedRevision: number,
    epoch: string,
    change: (session: SkillSession) => void | false
  ): Promise<SkillSession> {
    return this.mutate(id, (session) => {
      if (session.revision !== expectedRevision || session.epoch !== epoch) {
        throw new Error('SKILL_SESSION_STALE');
      }
      return change(session);
    });
  }

  /**
   * Replays an existing answer receipt before checking a now-stale expected revision; conflicting answers still fail.
   */
  async answer(
    id: string,
    revision: number,
    epoch: string,
    input: Parameters<typeof answerSkillSession>[1]
  ): Promise<{ session: SkillSession; accepted: boolean }> {
    let accepted = false;
    const session = await this.mutate(id, (session) => {
      if (Object.hasOwn(session.answers, input.submissionId)) {
        answerSkillSession(session, input);
        return false;
      }
      if (session.revision !== revision || session.epoch !== epoch) {
        throw new Error('SKILL_SESSION_STALE');
      }
      accepted = answerSkillSession(session, input);
    });
    return { session, accepted };
  }

  /**
   * Keeps read, validation and write inside the same IndexedDB transaction without awaiting external work.
   */
  private async mutate(id: string, change: (session: SkillSession) => void | false): Promise<SkillSession> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      let result: SkillSession;
      let failure: unknown;
      const store = tx.objectStore('sessions');
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const session = request.result as SkillSession | undefined;
          if (!session) {
            throw new Error('SKILL_SESSION_STALE');
          }
          const changed = change(session);
          if (changed !== false) {
            session.revision++;
            session.updatedAt = Date.now();
            if (new TextEncoder().encode(JSON.stringify(session)).length > 2 * 1024 * 1024) {
              throw new Error('SKILL_SESSION_LIMIT');
            }
            store.put(session);
          }
          result = session;
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new Error('SKILL_STORAGE', { cause: tx.error }));
    });
  }

  /**
   * Commits browser persistence and recording binding atomically; failed storage never replaces the previous skill.
   */
  async bindSaved(
    id: string,
    revision: number,
    epoch: string,
    binding: RecordingSkillBinding
  ): Promise<void> {
    const copy = readSkillCache(binding.cache);
    if (
      binding.storage !== 'browser' ||
      copy.snapshot.skillId !== binding.skillId ||
      copy.snapshot.definitionHash !== binding.definitionHash
    ) {
      throw new Error('SKILL_INVALID');
    }
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'bindings'], 'readwrite');
      let failure: unknown;
      const store = tx.objectStore('sessions');
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const session = request.result as SkillSession | undefined;
          if (
            !session ||
            session.revision !== revision ||
            session.epoch !== epoch ||
            session.status !== 'saving' ||
            binding.recordingId !== session.recordingId ||
            binding.sessionId !== id
          ) {
            throw new Error('SKILL_SESSION_STALE');
          }
          tx.objectStore('bindings').put(binding);
          const submission = Object.values(session.ledger).find(
            (entry) => entry.toolName === 'submit_skill' && !entry.result
          );
          if (submission) {
            const result = skillToolResult(submission, {
              skillId: binding.skillId,
              definitionHash: binding.definitionHash,
              saved: true,
              storage: binding.storage,
            });
            completeSkillTool(session, submission, result);
            session.messages.push({ role: 'tool', content: [result] });
          }
          session.status = 'completed';
          session.error = undefined;
          session.revision++;
          session.updatedAt = Date.now();
          store.put(session);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure ?? new Error('SKILL_STORAGE', { cause: tx.error }));
    });
  }

  /**
   * Updates only the selected skill association; late native replies cannot replace a newer generated skill.
   */
  async updateBinding(
    recordingId: string,
    skillId: string,
    change: (binding: RecordingSkillBinding) => void
  ): Promise<RecordingSkillBinding> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['bindings', 'sessions'], 'readwrite');
      const store = tx.objectStore('bindings');
      const request = store.get(recordingId);
      let result: RecordingSkillBinding;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const binding = request.result as RecordingSkillBinding | undefined;
          if (!binding || binding.skillId !== skillId) {
            throw new Error('SKILL_SESSION_STALE');
          }
          change(binding);
          if (binding.diskSave?.pending || binding.storage === 'executor') {
            const sessions = tx.objectStore('sessions');
            const owner = sessions.get(binding.sessionId);
            owner.onsuccess = () => {
              const session = owner.result as SkillSession | undefined;
              if (
                session?.mode === 'organize' &&
                session.operationId === skillId &&
                !session.localSkillFiles
              ) {
                session.localSkillFiles = true;
                session.revision++;
                session.updatedAt = Date.now();
                sessions.put(session);
              }
            };
          }
          result = binding;
          store.put(binding);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new Error('SKILL_STORAGE', { cause: tx.error }));
    });
  }

  /**
   * Resolves only the last successfully saved skill associated with a recording.
   */
  async binding(recordingId: string): Promise<RecordingSkillBinding | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('bindings').objectStore('bindings').get(recordingId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('SKILL_STORAGE', { cause: request.error }));
    });
  }

  /**
   * Reads lightweight saved bindings for recording list projections without loading skill definitions.
   */
  async bindings(): Promise<RecordingSkillBinding[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('bindings').objectStore('bindings').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('SKILL_STORAGE', { cause: request.error }));
    });
  }
}
