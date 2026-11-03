/**
 * @author Codex
 * @description Verifies real IndexedDB session CAS, answer receipts and saved bindings in isolated Chrome and Edge pages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const bundle = await build({
  stdin: {
    contents:
      "export * from './src/lib/skill-library/skill-snapshot'; export * from './src/lib/builtin-agent/skill-session'; export * from './src/lib/builtin-agent/skill-session-repository';",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  globalName: 'SkillStorageProbe',
});
/* global SkillStorageProbe */
for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: durable session transactions and duplicate answer receipts`,
    { timeout: 30000 },
    async () => {
      const server = createServer((request, response) => {
        response.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; connect-src 'none'"
        );
        if (request.url === '/probe.js') {
          response.setHeader('Content-Type', 'application/javascript');
          response.end(bundle.outputFiles[0].text);
        } else {
          response.end(
            '<!doctype html><title>Skill storage fixture</title><script src="/probe.js"></script>'
          );
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      let browser;
      try {
        browser = await chromium.launch({
          executablePath:
            flavor === 'chrome'
              ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
              : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
          headless: true,
        });
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const first = await page.evaluate(async () => {
          const { SkillSessionRepository, createSkillSession, admitSkillSessionTurn } = SkillStorageProbe;
          const retained = createSkillSession({
            id: crypto.randomUUID(),
            recordingId: crypto.randomUUID(),
            name: '新技能会话',
            mode: 'organize',
          });
          retained.candidate = {
            skillMarkdown: '---\nname: 原技能\ndescription: 查询\n---\n查询',
            workflow: {
              schemaVersion: 1,
              inputs: [],
              allowedOrigins: ['https://example.com'],
              pages: [{ role: 'main', startUrl: 'https://example.com' }],
              execution: { maxModelCalls: 12 },
              evidence: [],
            },
          };
          await new Promise((resolve, reject) => {
            const request = indexedDB.open('octopus-skill-sessions', 2);
            request.onupgradeneeded = () => {
              request.result
                .createObjectStore('sessions', { keyPath: 'id' })
                .createIndex('recording', 'recordingId');
              request.result.createObjectStore('bindings', { keyPath: 'recordingId' });
              request.result.createObjectStore('migrations');
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction(['sessions', 'bindings', 'migrations'], 'readwrite');
              tx.objectStore('sessions').put({
                ...retained,
                id: 'retired',
                historical: { source: 'workflow-history' },
              });
              tx.objectStore('sessions').put(retained);
              tx.objectStore('bindings').put({
                recordingId: retained.recordingId,
                skillId: '10000000-0000-4000-8000-000000000001',
                sessionId: retained.id,
                definitionHash: SkillStorageProbe.skillContentHash(retained.candidate),
                savedAt: 1,
              });
              tx.objectStore('migrations').put(true, 'workflow-history-v1');
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onabort = () => reject(tx.error);
            };
          });
          await new Promise((resolve, reject) => {
            const request = indexedDB.open('octopus-workflows', 2);
            request.onupgradeneeded = () => request.result.createObjectStore('workflows');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              request.result.close();
              resolve();
            };
          });
          await SkillStorageProbe.deleteRetiredWorkflowDatabase();
          if ((await indexedDB.databases()).some((db) => db.name === 'octopus-workflows')) {
            throw new Error('Retired database remains');
          }
          const repository = new SkillSessionRepository();
          const preserved = await repository.list();
          if (
            preserved.length !== 1 ||
            preserved[0].id !== retained.id ||
            (await repository.binding(retained.recordingId)).skillId !==
              '10000000-0000-4000-8000-000000000001'
          ) {
            throw new Error('Cleanup must discard only imported legacy rows');
          }

          const migrated = await repository.binding(retained.recordingId);
          if (
            migrated.storage !== 'executor' ||
            !migrated.cache?.snapshot.candidate.skillMarkdown.includes('原技能')
          ) {
            throw new Error('Existing file association lost its last saved copy');
          }
          const session = createSkillSession({
            id: crypto.randomUUID(),
            recordingId: crypto.randomUUID(),
            name: '查询',
            mode: 'organize',
          });
          await repository.create(session);
          const races = await Promise.allSettled([
            repository.update(session.id, 0, session.epoch, (value) => {
              value.modelCalls++;
            }),
            repository.update(session.id, 0, session.epoch, (value) => {
              value.modelCalls++;
            }),
          ]);
          const current = await repository.get(session.id);
          const waiting = await repository.update(session.id, current.revision, current.epoch, (value) => {
            admitSkillSessionTurn(value, [
              {
                toolCallId: 'question-1',
                toolName: 'ask_user_question',
                input: {
                  question: '请输入编号',
                  fields: [{ id: 'number', label: '编号', type: 'text', required: true, maxLength: 30 }],
                  allowDefer: false,
                },
              },
            ]);
          });
          const answer = {
            submissionId: crypto.randomUUID(),
            toolCallId: 'question-1',
            answer: { status: 'answered', values: { number: '000123' } },
          };
          const accepted = (await repository.answer(session.id, waiting.revision, waiting.epoch, answer))
            .session;
          const duplicate = (await repository.answer(session.id, waiting.revision, waiting.epoch, answer))
            .session;
          let conflict = false;
          try {
            await repository.answer(session.id, waiting.revision, waiting.epoch, {
              ...answer,
              answer: { status: 'answered', values: { number: 'other' } },
            });
          } catch {
            conflict = true;
          }
          sessionStorage.setItem('id', session.id);
          return {
            successes: races.filter((value) => value.status === 'fulfilled').length,
            modelCalls: current.modelCalls,
            revision: accepted.revision,
            duplicateRevision: duplicate.revision,
            conflict,
            messages: accepted.messages.length,
          };
        });
        assert.deepEqual(first, {
          successes: 1,
          modelCalls: 1,
          revision: 3,
          duplicateRevision: 3,
          conflict: true,
          messages: 1,
        });
        await page.reload();
        const restored = await page.evaluate(async () => {
          const repository = new SkillStorageProbe.SkillSessionRepository();
          const current = await repository.get(sessionStorage.getItem('id'));
          const saved = await repository.update(current.id, current.revision, current.epoch, (value) => {
            value.status = 'saving';
          });
          const binding = {
            recordingId: saved.recordingId,
            sessionId: saved.id,
            skillId: crypto.randomUUID(),
            definitionHash: 'a'.repeat(64),
            savedAt: 1,
            storage: 'browser',
          };
          const candidate = {
            skillMarkdown: '---\nname: 查询\ndescription: 查询订单\n---\n查询',
            workflow: {
              schemaVersion: 1,
              inputs: [],
              allowedOrigins: ['https://example.com'],
              pages: [{ role: 'main', startUrl: 'https://example.com' }],
              execution: { maxModelCalls: 12 },
              evidence: [],
            },
          };
          binding.definitionHash = SkillStorageProbe.skillContentHash(candidate);
          binding.cache = SkillStorageProbe.cacheSkill({
            skillId: binding.skillId,
            definitionHash: binding.definitionHash,
            candidate,
          });
          await repository.bindSaved(saved.id, saved.revision, saved.epoch, binding);
          const next = SkillStorageProbe.createSkillSession({
            id: crypto.randomUUID(),
            recordingId: saved.recordingId,
            name: '重新整理',
            mode: 'organize',
          });
          await repository.create(next);
          await repository.update(next.id, 0, next.epoch, (value) => {
            value.status = 'failed';
          });
          return {
            status: (await repository.get(saved.id)).status,
            unchangedBinding: (await repository.binding(saved.recordingId)).skillId === binding.skillId,
            answer: current.messages[0].content[0].output.value.values.number,
          };
        });
        assert.deepEqual(restored, { status: 'completed', unchangedBinding: true, answer: '000123' });
        const atomic = await page.evaluate(async () => {
          const repo = new SkillStorageProbe.SkillSessionRepository();
          const current = await repo.get(sessionStorage.getItem('id'));
          const original = await repo.binding(current.recordingId);
          const session = SkillStorageProbe.createSkillSession({
            id: crypto.randomUUID(),
            recordingId: current.recordingId,
            name: '新副本',
            mode: 'organize',
          });
          session.status = 'saving';
          await repo.create(session);
          const skillId = crypto.randomUUID();
          const next = {
            ...original,
            sessionId: session.id,
            skillId,
            cache: { ...original.cache, snapshot: { ...original.cache.snapshot, skillId } },
          };
          const put = IDBObjectStore.prototype.put;
          let failed = false;
          IDBObjectStore.prototype.put = function (value, ...rest) {
            if (this.name === 'bindings') {
              throw new DOMException('fixture quota', 'QuotaExceededError');
            }
            return put.call(this, value, ...rest);
          };
          try {
            await repo.bindSaved(session.id, 0, session.epoch, next);
          } catch {
            failed = true;
          } finally {
            IDBObjectStore.prototype.put = put;
          }
          const preserved =
            (await repo.binding(current.recordingId)).skillId === original.skillId &&
            (await repo.get(session.id)).status === 'saving';
          await repo.bindSaved(session.id, 0, session.epoch, next);
          let stale = false;
          try {
            await repo.updateBinding(current.recordingId, original.skillId, (value) => {
              value.storage = 'executor';
            });
          } catch {
            stale = true;
          }
          const replay = SkillStorageProbe.createSkillSession({
            id: crypto.randomUUID(),
            recordingId: current.recordingId,
            name: '旧副本确认',
            mode: 'replay',
          });
          let staleStart = false;
          try {
            await repo.create(replay, { skillId: original.skillId, contentHash: original.cache.contentHash });
          } catch {
            staleStart = true;
          }
          if (!staleStart || (await repo.get(replay.id))) {
            throw new Error('Stale snapshot started a session');
          }
          return {
            failed,
            preserved,
            stale,
            current: (await repo.binding(current.recordingId)).skillId === skillId,
          };
        });
        assert.deepEqual(atomic, { failed: true, preserved: true, stale: true, current: true });
        await page.evaluate(async () => {
          const repo = new SkillStorageProbe.SkillSessionRepository();
          const completed = (await repo.list()).find((value) => value.status === 'completed');
          const binding = await repo.binding(completed.recordingId);
          try {
            await repo.remove(completed.id, completed.revision + 1, completed.epoch);
            throw Error('stale deletion accepted');
          } catch (error) {
            if (error.message !== 'SKILL_SESSION_STALE') {
              throw error;
            }
          }
          await repo.remove(completed.id, completed.revision, completed.epoch);
          await repo.remove(completed.id, completed.revision, completed.epoch);
          if (await repo.get(completed.id)) {
            throw Error('Deleted task retained');
          }
          if (JSON.stringify(await repo.binding(completed.recordingId)) !== JSON.stringify(binding)) {
            throw Error('Deletion removed skill binding');
          }
          for (const status of ['running', 'saving', 'outcome_unknown']) {
            const session = SkillStorageProbe.createSkillSession({
              id: crypto.randomUUID(),
              recordingId: crypto.randomUUID(),
              name: '不可删除',
              mode: 'replay',
            });
            session.status = status;
            await repo.create(session);
            try {
              await repo.remove(session.id, 0, session.epoch);
              throw Error('unsafe deletion accepted');
            } catch (error) {
              if (error.message !== 'SKILL_DELETE_BLOCKED') {
                throw error;
              }
            }
          }
          const original = (await repo.bindings())[0];
          const recordingId = crypto.randomUUID();
          /**
           * Publishes an isolated generation with the same valid fixture payload.
           */
          async function generation() {
            const session = SkillStorageProbe.createSkillSession({
              id: crypto.randomUUID(),
              recordingId,
              name: '删除测试',
              mode: 'organize',
            });
            session.operationId = crypto.randomUUID();
            session.status = 'saving';
            const snapshot = { ...original.cache.snapshot, skillId: session.operationId };
            await repo.create(session);
            await repo.bindSaved(session.id, 0, session.epoch, {
              ...original,
              recordingId,
              sessionId: session.id,
              skillId: session.operationId,
              storage: 'browser',
              cache: SkillStorageProbe.cacheSkill(snapshot),
            });
            return repo.get(session.id);
          }
          const old = await generation();
          await repo.updateBinding(recordingId, old.operationId, (binding) => {
            binding.diskSave = { pending: true };
          });
          const exported = await repo.get(old.id);
          if (!exported.localSkillFiles || exported.revision <= old.revision) {
            throw Error('Export intent was not retained on its owning generation');
          }
          const latest = await generation();
          await repo.remove(exported.id, exported.revision, exported.epoch, true);
          if ((await repo.binding(recordingId)).skillId !== latest.operationId) {
            throw Error('Deleting older generation removed current binding');
          }
          await repo.remove(latest.id, latest.revision, latest.epoch, true);
          if (await repo.binding(recordingId)) {
            throw Error('Deleted skill binding survived');
          }
          const replay = SkillStorageProbe.createSkillSession({
            id: crypto.randomUUID(),
            recordingId,
            name: '重放',
            mode: 'replay',
          });
          replay.status = 'completed';
          replay.operationId = crypto.randomUUID();
          await repo.create(replay);
          try {
            await repo.remove(replay.id, 0, replay.epoch, true);
            throw Error('Replay deleted its source skill');
          } catch (error) {
            if (error.message !== 'SKILL_INVALID') {
              throw error;
            }
          }
        });
      } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  );
}
