/**
 * @author Codex
 * @description Owns atomic IndexedDB recording commits, event pagination and bounded retention.
 */
import {
  isActive,
  recordingLimits,
  type RecordingSession,
  type RecordedEvent,
  type RecordingCursor,
  type RecordingListPage,
  type RecordingSummary,
} from './recording-contract';

/**
 * Resolves a browser-owned request while preserving its transaction failure.
 */
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(new Error('RECORDING_STORAGE', { cause: value.error }));
  });
}

export class RecordingRepository {
  private connection?: Promise<IDBDatabase>;

  /**
   * Lazily opens extension-private storage; import alone has no storage side effects.
   */
  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise((resolve, reject) => {
      const pending = indexedDB.open('octopus-recordings', 2);
      pending.onupgradeneeded = () => {
        if (!pending.result.objectStoreNames.contains('sessions')) {
          pending.result.createObjectStore('sessions', { keyPath: 'id' });
          const events = pending.result.createObjectStore('events', { keyPath: ['sessionId', 'seq'] });
          events.createIndex('session', 'sessionId');
        }
        // Add the index in-place; existing recordings and events must not be reset during schema evolution.
        pending
          .transaction!.objectStore('sessions')
          .createIndex('chronological', ['startedAt', 'id'], { unique: true });
      };
      pending.onerror = () => {
        this.connection = undefined;
        reject(new Error('RECORDING_STORAGE'));
      };
      pending.onblocked = () => {
        this.connection = undefined;
        reject(new Error('RECORDING_STORAGE'));
      };
      pending.onsuccess = () => {
        const db = pending.result;
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
   * Returns metadata only, newest first; event bodies are separately paginated.
   */
  async list(): Promise<RecordingSession[]> {
    const db = await this.open();
    const result = await request<RecordingSession[]>(
      db.transaction('sessions').objectStore('sessions').getAll()
    );
    return result.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Reads terminal summaries using a stable exclusive key cursor, searching the whole eligible range.
   * A cursor is bound to the normalized search; one lookahead record determines whether another page exists.
   */
  async page(query = '', cursor: RecordingCursor | null = null, limit = 20): Promise<RecordingListPage> {
    const normalized = query.trim().normalize('NFKC').toLowerCase();
    if (cursor && cursor.query !== normalized) {
      throw new Error('RECORDING_STALE');
    }
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions');
      const range = cursor ? IDBKeyRange.upperBound(cursor.before, true) : undefined;
      const pending = tx.objectStore('sessions').index('chronological').openCursor(range, 'prev');
      const items: RecordingSummary[] = [];
      tx.onabort = () => reject(new Error('RECORDING_STORAGE', { cause: tx.error }));
      pending.onerror = () => reject(new Error('RECORDING_STORAGE', { cause: pending.error }));
      pending.onsuccess = () => {
        const entry = pending.result;
        if (!entry) {
          resolve({ items, nextCursor: null });
          return;
        }
        const session = entry.value as RecordingSession;
        if (!isActive(session) && session.name.normalize('NFKC').toLowerCase().includes(normalized)) {
          if (items.length === limit) {
            const last = items[items.length - 1]!;
            resolve({ items, nextCursor: { before: [last.startedAt, last.id], query: normalized } });
            return;
          }
          items.push({
            id: session.id,
            name: session.name,
            status: session.status,
            startedAt: session.startedAt,
            actionCount: session.actionCount,
            gapCount: session.gaps.length,
          });
        }
        entry.continue();
      };
    });
  }

  /**
   * Reads a saved recording without creating or restarting a session.
   */
  async get(id: string): Promise<RecordingSession | undefined> {
    const db = await this.open();
    return request(db.transaction('sessions').objectStore('sessions').get(id));
  }

  /**
   * Commits metadata and newly assigned event sequences together; callers ACK only after completion.
   */
  async save(
    session: RecordingSession,
    events: RecordedEvent[] = [],
    updates: RecordedEvent[] = []
  ): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('RECORDING_STORAGE', { cause: tx.error }));
      tx.onerror = () => {
        /* onabort owns the rejected transaction. */
      };
      tx.objectStore('sessions').put(session);
      for (const event of updates) {
        tx.objectStore('events').put(event);
      }
      for (const event of events) {
        tx.objectStore('events').add(event);
      }
    });
  }

  /**
   * Fetches at most fifty events in committed global sequence order.
   */
  async events(id: string, after = 0): Promise<RecordedEvent[]> {
    const db = await this.open();
    const range = IDBKeyRange.bound([id, after + 1], [id, Number.MAX_SAFE_INTEGER]);
    return request(db.transaction('events').objectStore('events').getAll(range, 50));
  }

  /**
   * Deletes a terminal recording and its events in the same transaction.
   */
  async delete(id: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'events'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('RECORDING_STORAGE'));
      tx.objectStore('sessions').delete(id);
      tx.objectStore('events').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    });
  }

  /**
   * Removes expired terminal recordings; active evidence is never evicted to make room.
   */
  async prune(now: number): Promise<void> {
    for (const session of await this.list()) {
      if (!isActive(session) && now - session.updatedAt > recordingLimits.retentionMs) {
        await this.delete(session.id);
      }
    }
  }
}
