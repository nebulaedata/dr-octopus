/**
 * @author Codex
 * @description Bounded child-process parser bridge; workers never open SQLite or LanceDB.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { KnowledgeError } from '../definitions/error.js';
import type { OcrConfig } from '../definitions/models.js';
import type { DocumentSection, ImportSource } from '../definitions/types.js';

export type DocumentWork = (
  | { kind: 'expand'; directory: string; source: ImportSource }
  | { kind: 'parse'; directory: string; source: ImportSource; ocr: OcrConfig | null }
) & { temporaryDirectory?: string };
export type DocumentWorkResult =
  { sources: ImportSource[] } | { sections: DocumentSection[] } | { sectionCount: number };

/**
 * Bound parser heap and wall time, and terminate only the child handle created for this attempt.
 */
export async function runDocumentWorker(
  work: DocumentWork,
  signal?: AbortSignal,
  onSection?: (section: DocumentSection) => Promise<void>
): Promise<DocumentWorkResult> {
  signal?.throwIfAborted();
  const temporaryDirectory = await mkdtemp(join(work.directory, 'parser-'));
  try {
    signal?.throwIfAborted();
    return await new Promise<DocumentWorkResult>((resolve, reject) => {
      const child = fork(fileURLToPath(new URL('./document-worker-entry.js', import.meta.url)), [], {
        execArgv: ['--max-old-space-size=768'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        serialization: 'advanced',
        env: { ...process.env, DR_OCTOPUS_PROCESS_ROLE: 'knowledge-parser' },
      });
      let settled = false;
      let pending = Promise.resolve();
      const sections: DocumentSection[] = [];
      let count = 0;
      let characters = 0;
      let remaining = 600_000;
      let started = Date.now();
      let timer = setTimeout(
        () => finish(new KnowledgeError('PARSER_TIMEOUT', '文档解析超过十分钟限制')),
        600_000
      );
      /**
       * Settle once and remove all observers before disposing the owned child.
       */
      function finish(error?: Error, result?: DocumentWorkResult): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        /**
         * Ownership ends only after the actual worker exits, including during daemon shutdown.
         */
        const complete = () => {
          void pending
            .catch(() => undefined)
            .then(() => {
              if (error) {
                reject(error);
              } else {
                resolve(result!);
              }
            });
        };
        if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
          complete();
        } else {
          child.once('exit', complete);
          child.kill();
        }
      }
      /**
       * Abort is local to this job attempt, never to a discovered or recycled process identifier.
       */
      function abort(): void {
        finish(new KnowledgeError('JOB_CANCELLED', '文档解析已取消'));
      }
      signal?.addEventListener('abort', abort, { once: true });
      child.once('error', () =>
        finish(new KnowledgeError('PARSER_UNAVAILABLE', '无法启动文档解析进程', true))
      );
      child.once('exit', () => finish(new KnowledgeError('PARSER_FAILED', '文档解析进程异常退出', true)));
      child.on('message', (value: unknown) => {
        const message = value as {
          section?: DocumentSection;
          result?: DocumentWorkResult;
          error?: { code: string; message: string; retryable?: boolean };
        };
        if (settled) {
          return;
        }
        if (message.section) {
          const section = message.section;
          if (
            typeof section.text !== 'string' ||
            section.text.length > 1_048_576 ||
            ++count > 100_000 ||
            (characters += section.text.length) > 10_000_000
          ) {
            finish(new KnowledgeError('DOCUMENT_LIMIT', '解析输出超过限制'));
            return;
          }
          clearTimeout(timer);
          remaining -= Date.now() - started;
          pending = pending.then(async () => {
            signal?.throwIfAborted();
            if (onSection) {
              await onSection(section);
            } else {
              sections.push(section);
            }
            if (!settled && child.connected) {
              started = Date.now();
              timer = setTimeout(
                () => finish(new KnowledgeError('PARSER_TIMEOUT', '文档解析超过十分钟限制')),
                Math.max(1, remaining)
              );
              child.send({ ack: true }, (error) => {
                if (error) {
                  finish(new KnowledgeError('PARSER_FAILED', '解析确认发送失败'));
                }
              });
            }
          });
          void pending.catch((error: unknown) =>
            finish(error instanceof Error ? error : new KnowledgeError('PARSER_FAILED', '文档消费失败'))
          );
          return;
        }
        if (message.error) {
          finish(new KnowledgeError(message.error.code, message.error.message, message.error.retryable));
        } else if (
          message.result &&
          (('sources' in message.result && Array.isArray(message.result.sources)) ||
            ('sections' in message.result && Array.isArray(message.result.sections)) ||
            ('sectionCount' in message.result && Number.isInteger(message.result.sectionCount)))
        ) {
          if ('sectionCount' in message.result && message.result.sectionCount !== count) {
            finish(new KnowledgeError('PARSER_FAILED', '解析段落数量不一致'));
            return;
          }
          finish(undefined, 'sectionCount' in message.result && !onSection ? { sections } : message.result);
        } else {
          finish(new KnowledgeError('PARSER_FAILED', '文档解析响应无效'));
        }
      });
      child.send({ ...work, temporaryDirectory }, (error) => {
        if (error) {
          finish(new KnowledgeError('PARSER_UNAVAILABLE', '无法提交文档解析任务', true));
        }
      });
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
