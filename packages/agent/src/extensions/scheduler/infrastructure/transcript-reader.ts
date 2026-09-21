/**
 * @author Codex
 * @description Resolves scoped run artifacts into bounded read-only transcripts without exposing internal paths.
 */
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { runs, tasks } from './schema.js';
import { SchedulerTaskError } from '../definitions/task-error.js';
import type { SchedulerDatabase } from './database.js';
import type { SchedulerTaskScope } from '../definitions/tasks.js';
import type { SchedulerResult } from '../definitions/result.js';

/**
 * Hold only the daemon database reference; files are opened for each bounded read and always closed.
 */
export class SchedulerTranscriptReader {
  /**
   * Fix the artifact root at composition time, never accepting it from clients.
   */
  constructor(
    private readonly database: SchedulerDatabase,
    private readonly directory: string
  ) {}

  /**
   * Export settled identity only to the authenticated Host; resolve artifact containment before sharing a path.
   */
  async result(scope: SchedulerTaskScope, taskId: string, runId: string): Promise<SchedulerResult> {
    const row = this.database.db
      .select({ run: runs, taskName: tasks.name })
      .from(runs)
      .innerJoin(tasks, eq(tasks.id, runs.taskId))
      .where(
        and(
          eq(runs.id, runId),
          eq(tasks.id, taskId),
          eq(tasks.workspaceId, scope.workspaceId),
          scope.originSessionRef === undefined
            ? undefined
            : scope.originSessionRef === null
              ? isNull(runs.originSessionRef)
              : eq(runs.originSessionRef, scope.originSessionRef)
        )
      )
      .get();
    if (!row) {
      throw new SchedulerTaskError('SCHEDULE_RUN_NOT_FOUND', 'Scheduled run not found');
    }
    const run = row.run;
    if (!run.settledAt || ['queued', 'claimed', 'dispatching', 'running'].includes(run.status)) {
      throw new SchedulerTaskError('SCHEDULE_RESULT_PENDING', 'Run has not settled');
    }
    let session: SchedulerResult['session'] = null;
    let artifactError: string | undefined;
    if (run.sessionPath && run.sessionId) {
      try {
        const root = await realpath(join(this.directory, 'runs'));
        const runRoot = await realpath(join(root, run.id));
        const path = await realpath(run.sessionPath);
        for (const suffix of [relative(root, runRoot), relative(runRoot, path)]) {
          if (!suffix || suffix.startsWith('..') || isAbsolute(suffix)) {
            throw new Error('Artifact escaped its run root');
          }
        }
        session = { id: run.sessionId, path };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          artifactError = 'SCHEDULE_ARTIFACT_MISSING';
        } else {
          throw new SchedulerTaskError('SCHEDULE_ARTIFACT_UNAVAILABLE', 'Run artifact is unavailable');
        }
      }
    }
    return {
      workspaceId: run.workspaceId,
      taskName: row.taskName,
      originSessionRef: run.originSessionRef,
      cwd: run.cwd,
      prompt: run.prompt,
      session,
      ...(artifactError ? { artifactError } : {}),
      run: {
        id: run.id,
        taskId: run.taskId,
        status: run.status,
        scheduledFor: run.scheduledFor,
        triggerSource: run.triggerSource,
        cancelRequestedAt: run.cancelRequestedAt,
        startedAt: run.startedAt,
        settledAt: run.settledAt,
        summary: run.summary,
        errorCode: run.errorCode,
        createdAt: run.createdAt,
      },
    };
  }

  /**
   * Read the latest complete messages from at most 256 KiB, preserving tool results without private metadata.
   */
  async read(scope: SchedulerTaskScope, taskId: string, runId: string) {
    const run = this.database.db
      .select({ path: runs.sessionPath })
      .from(runs)
      .innerJoin(tasks, eq(tasks.id, runs.taskId))
      .where(
        and(
          eq(runs.id, runId),
          eq(tasks.id, taskId),
          eq(tasks.workspaceId, scope.workspaceId),
          scope.originSessionRef === undefined
            ? undefined
            : scope.originSessionRef === null
              ? isNull(tasks.originSessionRef)
              : eq(tasks.originSessionRef, scope.originSessionRef)
        )
      )
      .get();
    if (!run) {
      throw new SchedulerTaskError('SCHEDULE_RUN_NOT_FOUND', 'Scheduled run not found');
    }
    if (!run.path) {
      return { runId, entries: [], truncated: false };
    }
    try {
      const root = await realpath(join(this.directory, 'runs', runId));
      const file = await realpath(run.path);
      const suffix = relative(root, file);
      if (suffix.startsWith('..') || isAbsolute(suffix)) {
        throw new Error('Artifact escaped its run root');
      }
      const handle = await open(file, 'r');
      try {
        const size = (await handle.stat()).size;
        const start = Math.max(0, size - 256 * 1024);
        const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
        if (start > 0) {
          lines.shift();
        }
        const entries: { role: string; text: string }[] = [];
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as {
              type?: unknown;
              message?: { role?: unknown; content?: unknown };
            };
            if (entry?.type !== 'message' || !entry.message || typeof entry.message.role !== 'string') {
              continue;
            }
            const content = entry.message.content;
            const parts: unknown[] = Array.isArray(content) ? content : [];
            const text =
              typeof content === 'string'
                ? content
                : parts
                    .map((value) => {
                      if (!value || typeof value !== 'object') {
                        return '';
                      }
                      const part = value as { type?: unknown; text?: unknown; name?: unknown };
                      return part.type === 'text' && typeof part.text === 'string'
                        ? part.text
                        : part.type === 'toolCall' && typeof part.name === 'string'
                          ? `[Tool: ${part.name}]`
                          : '';
                    })
                    .filter(Boolean)
                    .join('\n');
            if (text) {
              entries.push({ role: entry.message.role, text: text.slice(0, 8000) });
            }
          } catch {
            /* An active writer may leave an incomplete final line. */
          }
        }
        return { runId, entries: entries.slice(-100), truncated: start > 0 || entries.length > 100 };
      } finally {
        await handle.close();
      }
    } catch {
      throw new SchedulerTaskError(
        'SCHEDULE_ARTIFACT_UNAVAILABLE',
        'Run transcript is currently unavailable'
      );
    }
  }
}
