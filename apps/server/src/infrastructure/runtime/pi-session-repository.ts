/**
 * @author Codex
 * @description Adapts Pi SessionManager and JSONL headers to authoritative Session persistence operations.
 */

import { open, unlink, writeFile } from 'node:fs/promises';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { SessionRuntimeError } from './errors.js';
import { hasErrorCode, isFileExistsError } from '../../utils/value-utils.js';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export interface PiSessionMetadata {
  sessionId: string;
  cwd: string;
}

export interface DerivedPiSession {
  path: string;
  sessionId: string;
  prefill?: string;
}

/**
 * Keeps Pi JSONL parsing, history reads, and offline derivation behind one Sessions persistence Adapter.
 */
export class PiSessionRepository {
  /**
   * Reads append-order entries, optionally after a durable entry cursor.
   */
  public getEntries(sessionPath: string, since?: string): { entries: SessionEntry[]; leafId: string | null } {
    const manager = SessionManager.open(sessionPath);
    const entries = manager.getEntries();
    const index = since === undefined ? -1 : entries.findIndex((entry) => entry.id === since);
    return { entries: index < 0 ? entries : entries.slice(index + 1), leafId: manager.getLeafId() };
  }

  /**
   * Reads only the entries reachable from the current leaf.
   *
   * @param sessionPath Pi Session JSONL path.
   * @returns Current branch entries in root-to-leaf order.
   */
  public getBranch(sessionPath: string): SessionEntry[] {
    return SessionManager.open(sessionPath).getBranch();
  }

  /**
   * Reads the branch tree and current leaf directly from the Pi Session.
   */
  public getTree(sessionPath: string): {
    tree: ReturnType<SessionManager['getTree']>;
    leafId: string | null;
  } {
    const manager = SessionManager.open(sessionPath);
    return { tree: manager.getTree(), leafId: manager.getLeafId() };
  }

  /**
   * Deletes the Pi Session JSONL file when the caller also wants to remove raw data.
   */
  public async delete(sessionPath: string): Promise<void> {
    try {
      await unlink(sessionPath);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return;
      }
      throw new SessionRuntimeError(
        'SESSION_METADATA_INVALID',
        `Unable to delete Session file: ${sessionPath}`,
        error
      );
    }
  }

  /**
   * Creates a new Pi Session file without replacing or stopping the source runtime.
   */
  public async derive(
    sourcePath: string,
    mode: 'fork' | 'clone',
    entryId?: string
  ): Promise<DerivedPiSession> {
    const manager = SessionManager.open(sourcePath);
    let targetLeafId = manager.getLeafId();
    let prefill: string | undefined;
    if (mode === 'fork') {
      if (entryId === undefined) {
        throw new Error('entryId is required for fork.');
      }
      const selected = manager.getEntry(entryId);
      if (selected?.type !== 'message' || selected.message.role !== 'user') {
        throw new Error('Fork target must be a user message.');
      }
      targetLeafId = selected.parentId;
      prefill =
        typeof selected.message.content === 'string'
          ? selected.message.content
          : selected.message.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n');
    }
    const derived = this.#createDerivedSession(manager, sourcePath, targetLeafId);
    await this.#persistDerivedSession(derived.manager, derived.path);
    const derivedPath = derived.path;
    const metadata = await this.readMetadata(derivedPath);
    return {
      path: derivedPath,
      sessionId: metadata.sessionId,
      ...(prefill === undefined ? {} : { prefill }),
    };
  }

  /**
   * Reads and validates only the bounded first JSONL header.
   */
  public async readMetadata(sessionPath: string): Promise<PiSessionMetadata> {
    const handle = await open(sessionPath, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
      if (newline < 0) {
        throw new SessionRuntimeError(
          'SESSION_METADATA_INVALID',
          'Session header exceeds 64 KiB or has no newline.'
        );
      }
      const header = JSON.parse(buffer.subarray(0, newline).toString('utf8')) as Record<string, unknown>;
      if (header.type !== 'session' || typeof header.id !== 'string' || typeof header.cwd !== 'string') {
        throw new SessionRuntimeError(
          'SESSION_METADATA_INVALID',
          'Session header is missing type, id, or cwd.'
        );
      }
      return { sessionId: header.id, cwd: header.cwd };
    } catch (error) {
      if (error instanceof SessionRuntimeError) {
        throw error;
      }
      throw new SessionRuntimeError(
        'SESSION_METADATA_INVALID',
        `Unable to read Session metadata: ${sessionPath}`,
        error
      );
    } finally {
      await handle.close();
    }
  }

  /**
   * Applies Pi's supported branch creation primitives and requires a durable output path.
   */
  #createDerivedSession(
    manager: SessionManager,
    sourcePath: string,
    targetLeafId: string | null
  ): { manager: SessionManager; path: string } {
    let derivedPath: string | undefined;
    let derivedManager = manager;
    if (targetLeafId === null) {
      const empty = SessionManager.create(manager.getCwd(), manager.getSessionDir());
      empty.newSession({ parentSession: sourcePath });
      derivedPath = empty.getSessionFile();
      derivedManager = empty;
    } else {
      derivedPath = manager.createBranchedSession(targetLeafId);
    }
    if (derivedPath === undefined) {
      throw new Error('Pi did not create a derived Session file.');
    }
    return { manager: derivedManager, path: derivedPath };
  }

  /**
   * Atomically materializes a dormant derived Session when Pi intentionally defers its first write.
   */
  async #persistDerivedSession(manager: SessionManager, sessionPath: string): Promise<void> {
    const entries = [manager.getHeader(), ...manager.getEntries()].filter((entry) => entry !== null);
    try {
      await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      if (isFileExistsError(error)) {
        return;
      }
      throw new SessionRuntimeError(
        'SESSION_METADATA_INVALID',
        'Unable to persist the derived Session.',
        error
      );
    }
  }
}
