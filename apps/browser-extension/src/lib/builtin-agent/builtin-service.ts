/**
 * @author Codex
 * @description Coordinates durable Skill sessions and short-lived Agent Hosts with authenticated external-tool dispatch.
 */
import { recordSkillResponse, type SkillFinishReason } from './skill-response';
import { safeToolIssues } from './skill-tool-diagnostic';
import { browser } from 'wxt/browser';
import { PageAccessError, pageAccessMessage, pageAccessSchema } from '../../page-access';
import { pageWaitStepTimeout } from '../../page-wait-policy';
import { WindowPanels } from './window-panel';
import { z } from 'zod';
import {
  browserSkillPackageSchema,
  browserSkillReceiptSchema,
  browserSkillSnapshotSchema,
} from '@octopus/shared/protocol/browser-skills';
import {
  browserParams,
  snapshotPageSchema,
  type BrowserMethod,
} from '@octopus/shared/protocol/browser-tools';
import type { BrowserRouter } from '../../browser-router';
import { RecordingRepository } from '../recording/recording-repository';
import type { RecordedEvent } from '../recording/recording-contract';
import { prepareRecordingEvidence, recordingToolPage } from '../recording/recording-evidence';
import { validateSkillCandidate } from '../skill-organization/skill-validator';
import {
  recordingChoices,
  requiresNewControlCapture,
  applyChoiceDecisions,
} from '../recording/recording-choices';
import { applyChoiceParams } from '../../page-commands';
import { modelSettingsSchema } from '../model-settings/model-settings-messages';
import type { ModelSettingsRepository } from '../model-settings/model-settings-repository';
import type { SkillFileClient } from '../skill-library/skill-file-client';
import { skillCommandSchema, type SkillCommand, type RecordingSkillState } from './skill-messages';
import { skillBudgetSchema, skillBudgetDefaults, skillModelLimit } from './skill-budget';
import { SkillSessionRepository, type RecordingSkillBinding } from './skill-session-repository';
import { cacheSkill, readSkillCache, skillContentHash } from '../skill-library/skill-snapshot';
import {
  createSkillSession,
  skillDeletionBlock,
  extendSkillBudget,
  reserveSkillModelCall,
  admitSkillSessionTurn,
  dispatchSkillTool,
  settleSkillTool,
  completeSkillTool,
  skillToolResult,
  interruptSkillSession,
  type SkillSession,
  type SkillToolCall,
} from './skill-session';

type Sender = Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1];

export class BuiltinAgentService {
  private readonly panels = new WindowPanels();
  private initialized?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sessions = new SkillSessionRepository();
  private readonly recordings = new RecordingRepository();

  /**
   * Borrows existing browser and credential authorities; no model runs in Worker or Executor.
   */
  constructor(
    private readonly router: BrowserRouter,
    private readonly files: SkillFileClient,
    private readonly settings: ModelSettingsRepository
  ) {}

  /**
   * Serializes authority mutations without waiting for model or page execution on this queue.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Preserves waiting questions and uncertain effects across Worker restarts without automatically resending requests.
   */
  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      for (const session of await this.sessions.list()) {
        let recovered = session;
        if (['running', 'saving'].includes(session.status) || session.hostWindowId !== undefined) {
          recovered = await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
            interruptSkillSession(value);
            if (value.candidate && value.operationId) {
              value.status = 'saving';
              value.error = 'SKILL_STORAGE';
            }
            delete value.hostWindowId;
            delete value.hostDocumentId;
            delete value.hostDelivered;
          });
        }
        if (recovered.mode === 'replay' && recovered.status === 'outcome_unknown') {
          this.router.restoreUncertainLocal(recovered.id);
        }
      }
    })().catch((error: unknown) => {
      this.initialized = undefined;
      throw error;
    });
    return this.initialized;
  }

  /**
   * Restores durable page reservations before Native or local automation can enter the shared router.
   */
  ready(): Promise<void> {
    return this.initialize();
  }

  /**

   * Registers the window panel and interrupts only tasks owned by a disappearing document.

   */
  connect(port: ReturnType<typeof browser.runtime.connect>): void {
    this.panels.connect(port, (documentId) => {
      void this.serial(async () => {
        await this.initialize();
        for (const session of await this.sessions.list()) {
          if (session.panelDocumentId !== documentId || !['running', 'saving'].includes(session.status)) {
            continue;
          }
          await this.closeHost(session);
          const current = await this.required(session.id);
          await this.sessions.update(current.id, current.revision, current.epoch, (value) => {
            interruptSkillSession(value);
            value.error = 'SKILL_HOST_CLOSED';
          });
          await this.router.releaseLocal(session.id).catch(() => {});
        }
        await this.publish();
      }).catch(() => {});
    });
  }

  /**
   * Accepts only Popup management and the exact registered top-level Host document.
   */
  receive(raw: unknown, sender: Sender): Promise<unknown> | undefined {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('type' in raw) ||
      typeof raw.type !== 'string' ||
      !raw.type.startsWith('skill.')
    ) {
      return;
    }
    if (sender.id !== browser.runtime.id) {
      return;
    }
    const parsed = skillCommandSchema.safeParse(raw);
    if (!parsed.success || new TextEncoder().encode(JSON.stringify(raw)).length > 256 * 1024) {
      return Promise.resolve({ ok: false, error: 'SKILL_INVALID' });
    }
    return this.serial(async () => {
      await this.initialize();
      const registeredPanel = sender.tab ? undefined : this.panels.fromUrl(sender.url);
      if (registeredPanel && sender.documentId && sender.documentId !== registeredPanel.documentId) {
        throw Error('SKILL_FORBIDDEN');
      }
      if (registeredPanel) {
        sender = { ...sender, documentId: registeredPanel.documentId };
      }
      const command = parsed.data;
      if (command.type.startsWith('skill.host.')) {
        if (!('id' in command) || !('epoch' in command)) {
          throw new Error('SKILL_SESSION_STALE');
        }
        const session = await this.required(command.id);
        if (
          session.epoch !== command.epoch ||
          !registeredPanel ||
          !this.panels.get(sender.documentId) ||
          session.panelDocumentId !== sender.documentId ||
          session.hostWindowId !== this.panels.get(sender.documentId)?.windowId ||
          !sender.documentId ||
          (session.hostDocumentId && session.hostDocumentId !== sender.documentId)
        ) {
          throw new Error('SKILL_SESSION_STALE');
        }
        if (command.type === 'skill.host.ready') {
          try {
            return await this.hostReady(session, sender.documentId);
          } catch (error) {
            await this.closeHost(session);
            const current = await this.required(session.id);
            await this.sessions.update(current.id, current.revision, current.epoch, (value) => {
              value.status = 'failed';
              value.error = this.code(error);
            });
            await this.router.releaseLocal(current.id).catch(() => {});
            throw error;
          }
        }
        if (!session.hostDelivered) {
          throw new Error('SKILL_SESSION_STALE');
        }
        if (command.type === 'skill.host.prepare') {
          const access = session.pageAccess;
          const restored =
            access?.reason === 'permission' &&
            access.origin &&
            (await this.router.hasSitePermission(access.origin));
          const updated = await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
            if (restored) {
              delete value.pageAccess;
              value.observationRequired = true;
              delete value.toolFailures?.browser_snapshot;
            }
            reserveSkillModelCall(value, session.epoch);
          });
          return {
            messages: updated.messages,
            responseRecovery: updated.responseRecovery === true,
            pageAccess: updated.pageAccess,
          };
        }
        if (command.type === 'skill.host.step') {
          return this.recordStep(session, command.calls, command.messages, command.finishReason);
        }
        if (command.type === 'skill.host.checkpoint') {
          const updated = await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
            const step = value.sdkStep;
            if (!step || step.modelCall !== value.modelCalls) {
              throw Error('SKILL_SESSION_STALE');
            }
            // A failed/refused response retains the explicit non-execution receipts committed by admission.
            if (value.responses?.at(-1)?.classification === 'tools') {
              value.messages.splice(step.start, value.messages.length - step.start, ...command.messages);
            }
            delete value.sdkStep;
          });
          return {
            stopped: updated.status !== 'running' || updated.modelCalls >= skillModelLimit(updated),
          };
        }
        if (command.type === 'skill.host.tool') {
          return { runTool: () => this.executeAdmittedTool(session, command.toolCallId) };
        }
        if (command.type === 'skill.host.end') {
          await this.closeHost(session);
          const current = await this.required(session.id);
          if (current.status === 'running') {
            await this.sessions.update(current.id, current.revision, current.epoch, (value) => {
              value.status = 'failed';
              value.error =
                value.modelCalls >= skillModelLimit(value) ? 'SKILL_MODEL_BUDGET' : 'SKILL_NO_TOOL';
            });
          }
          if (current.status !== 'outcome_unknown') {
            await this.router.releaseLocal(session.id).catch(() => {});
          }
          return true;
        }
        if (command.type === 'skill.host.failed') {
          await this.closeHost(session);
          const current = await this.required(session.id);
          await this.fail(current.id, current.epoch, Error(command.error));
          return this.required(current.id);
        }
      }
      const panel = this.panels.get(sender.documentId);
      if (sender.url !== browser.runtime.getURL('/popup.html') && !(registeredPanel && panel)) {
        throw new Error('SKILL_FORBIDDEN');
      }
      if (command.type === 'skill.panel.view') {
        if (!panel) {
          throw Error('SKILL_PANEL_REQUIRED');
        }
        await this.panels.remember(panel.windowId, command.route);
        return true;
      }
      if (command.type === 'skill.panel.open') {
        if (sender.url !== browser.runtime.getURL('/popup.html')) {
          throw Error('SKILL_FORBIDDEN');
        }
        const window = await browser.windows.get(command.windowId);
        if (window.incognito || window.type !== 'normal') {
          throw Error('SKILL_FORBIDDEN');
        }
        await this.panels.route(command.windowId, command.route);
        return true;
      }
      if (command.type === 'skill.delete' && !panel) {
        throw Error('SKILL_PANEL_REQUIRED');
      }
      const execution = [
        'skill.start',
        'skill.answer',
        'skill.continue',
        'skill.extend-budget',
        'skill.cancel',
        'skill.resolve-unknown',
        'skill.retry-save',
      ].includes(command.type);
      if (execution && !panel) {
        throw Error('SKILL_PANEL_REQUIRED');
      }
      if (
        panel &&
        ['skill.continue', 'skill.extend-budget', 'skill.answer'].includes(command.type) &&
        'id' in command &&
        (await this.sessions.list()).some(
          (value) =>
            value.id !== command.id &&
            value.windowId === panel.windowId &&
            ['running', 'saving'].includes(value.status)
        )
      ) {
        throw Error('SKILL_BUSY');
      }
      if (execution && panel && 'id' in command) {
        const current = await this.required(command.id);
        if (current.panelDocumentId !== panel.documentId) {
          if (
            ('epoch' in command && current.epoch !== command.epoch) ||
            ('revision' in command && current.revision !== command.revision)
          ) {
            throw Error('SKILL_SESSION_STALE');
          }
          if (
            this.panels.get(current.panelDocumentId) &&
            ['running', 'waiting_user', 'saving', 'outcome_unknown'].includes(current.status)
          ) {
            throw Error('SKILL_PANEL_OWNER');
          }
          await this.sessions.update(current.id, current.revision, current.epoch, (value) => {
            value.windowId = panel.windowId;
            value.panelDocumentId = panel.documentId;
          });
          // Keep client CAS checks meaningful after a deliberate document handoff.
          if ('revision' in command) {
            command.revision += 1;
          }
        }
      }
      const value = await this.manage(command, panel);
      if (
        execution &&
        panel &&
        value &&
        typeof value === 'object' &&
        'recordingId' in value &&
        'id' in value &&
        'mode' in value
      ) {
        const task = value as SkillSession;
        await this.panels.route(
          panel.windowId,
          { recordingId: task.recordingId, mode: task.mode, sessionId: task.id },
          false
        );
      }
      return value;
    }).then(
      async (value) => {
        if (value && typeof value === 'object' && 'runTool' in value && typeof value.runTool === 'function') {
          try {
            value = await value.runTool();
          } catch (error) {
            await this.publish();
            return { ok: false, error: this.code(error) };
          }
        }
        if (
          !['skill.state', 'skill.get', 'skill.recordings', 'skill.history', 'skill.panel.view'].includes(
            parsed.data.type
          )
        ) {
          await this.publish();
        }
        return { ok: true, value };
      },
      async (error: unknown) => {
        if (parsed.data.type.startsWith('skill.host.')) {
          await this.publish();
        }
        return { ok: false, error: this.code(error) };
      }
    );
  }

  /**
   * Publishes a revision marker only; Popup always reads authoritative sessions from IndexedDB through Worker.
   */
  private async publish(): Promise<void> {
    await browser.storage.local.set({ skillRevision: crypto.randomUUID() });
  }

  /**
   * Reads a concrete task identity instead of implicitly replacing a historical detail with the latest task.
   */
  private async required(id: string): Promise<SkillSession> {
    const session = await this.sessions.get(id);
    if (!session) {
      throw new Error('SKILL_MISSING');
    }
    return session;
  }

  /**
   * Drops infrastructure exception bodies at the UI/model boundary.
   */
  private code(error: unknown): string {
    return error instanceof Error && /^[A-Z][A-Z_]{1,79}$/.test(error.message)
      ? error.message
      : 'SKILL_STORAGE';
  }

  /**
   * Executes explicit user operations; no management command accepts arbitrary chat text or paths.
   */
  private async manage(
    command: SkillCommand,
    panel?: { windowId: number; documentId: string }
  ): Promise<unknown> {
    if (command.type === 'skill.delete') {
      const session = await this.sessions.get(command.id);
      if (session && command.deleteSkill) {
        if (session.revision !== command.revision || session.epoch !== command.epoch) {
          throw Error('SKILL_SESSION_STALE');
        }
        if (skillDeletionBlock(session)) {
          throw Error('SKILL_DELETE_BLOCKED');
        }
        if (session.mode !== 'organize' || !session.operationId) {
          throw Error('SKILL_INVALID');
        }
        const usingSkill = (await this.sessions.list()).some(
          (other) =>
            other.id !== session.id &&
            other.context?.skill?.skillId === session.operationId &&
            (!['completed', 'failed', 'cancelled'].includes(other.status) ||
              Boolean(skillDeletionBlock(other)))
        );
        if (usingSkill) {
          throw Error('SKILL_IN_USE');
        }
        const binding = await this.sessions.binding(session.recordingId);
        const ownsBinding = binding?.skillId === session.operationId && binding.sessionId === session.id;
        // A previous interrupted export may have committed despite losing its receipt.
        const localFiles =
          session.localSkillFiles ||
          (ownsBinding && (binding.storage === 'executor' || Boolean(binding.diskSave))) ||
          (session.localSkillFiles === undefined && !ownsBinding);
        if (localFiles) {
          try {
            const result = await this.files.request({ type: 'skills.delete', skillId: session.operationId });
            if (!result || !('deleted' in result) || result.deleted !== true) {
              throw Error('SKILL_DELETE_FILES_FAILED');
            }
          } catch {
            throw Error('SKILL_DELETE_FILES_FAILED');
          }
        }
      }
      await this.sessions.remove(command.id, command.revision, command.epoch, command.deleteSkill);
      // A route is a view preference; a failed cleanup must not undo committed session deletion.
      await this.panels.forget(command.id).catch(() => {});
      return true;
    }
    if (command.type === 'skill.history') {
      if (
        command.cursor &&
        (command.cursor.recordingId !== command.recordingId || command.cursor.mode !== command.mode)
      ) {
        throw Error('SKILL_INVALID');
      }
      const sessions = (await this.sessions.list()).sort(
        (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
      );
      const all = sessions.filter(
        (session) =>
          (!command.recordingId || session.recordingId === command.recordingId) &&
          (!command.mode || session.mode === command.mode)
      );
      const cursor = command.cursor;
      const rows = cursor
        ? all.filter(
            (session) =>
              session.updatedAt < cursor.updatedAt ||
              (session.updatedAt === cursor.updatedAt && session.id > cursor.id)
          )
        : all;
      /**
       * Projects list metadata without exposing messages, credentials or skill contents.
       */
      const project = (session: SkillSession) => ({
        id: session.id,
        recordingId: session.recordingId,
        mode: session.mode,
        name: session.name,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        windowId: session.windowId,
        retryOf: session.retryOf,
        model: session.context?.settings.model,
      });
      const items = rows.slice(0, 20).map(project);
      const last = items.at(-1);
      return {
        items,
        total: all.length,
        active: sessions
          .filter((session) =>
            ['running', 'waiting_user', 'saving', 'outcome_unknown'].includes(session.status)
          )
          .map(project),
        cursor:
          rows.length > 20 && last
            ? { recordingId: command.recordingId, mode: command.mode, id: last.id, updatedAt: last.updatedAt }
            : undefined,
      };
    }
    if (command.type === 'skill.recordings') {
      const rows = new Map<string, RecordingSkillState>();
      for (const binding of await this.sessions.bindings()) {
        rows.set(binding.recordingId, {
          recordingId: binding.recordingId,
          status: 'organized',
          skillId: binding.skillId,
        });
      }
      for (const session of (await this.sessions.list()).reverse()) {
        if (session.mode === 'organize' && ['running', 'waiting_user', 'saving'].includes(session.status)) {
          let status: RecordingSkillState['status'] = 'waiting_user';
          if (session.status === 'running') {
            status = 'organizing';
          } else if (session.status === 'saving') {
            status = 'saving';
          }
          rows.set(session.recordingId, {
            ...rows.get(session.recordingId),
            recordingId: session.recordingId,
            status,
          });
        }
      }
      return [...rows.values()];
    }
    if (command.type === 'skill.state') {
      return {
        sessions: await this.sessions.list(command.recordingId),
        binding: await this.sessions.binding(command.recordingId),
        fileConnected: this.files.connected(),
      };
    }
    if (command.type === 'skill.get') {
      return this.required(command.id);
    }
    if (command.type === 'skill.start') {
      return this.start(command.recordingId, command.mode, command.consent, command.browserCopy, panel);
    }
    if (command.type === 'skill.open-directory') {
      const binding = await this.sessions.binding(command.recordingId);
      if (!binding) {
        throw new Error('SKILL_MISSING');
      }
      if (binding.storage !== 'executor') {
        throw new Error('SKILL_EXECUTOR_NOT_SAVED');
      }
      return this.files.request({ type: 'skills.open-directory', skillId: binding.skillId });
    }
    if (command.type === 'skill.export' || command.type === 'skill.save-to-executor') {
      const binding = await this.sessions.binding(command.recordingId);
      if (!binding || binding.skillId !== command.skillId) {
        throw new Error('SKILL_SESSION_STALE');
      }
      const cache = this.localCopy(binding);
      if (command.type === 'skill.export') {
        return cache;
      }
      if (binding.storage === 'executor') {
        return binding;
      }
      await this.sessions.updateBinding(binding.recordingId, binding.skillId, (value) => {
        value.diskSave = { pending: true };
      });
      try {
        let receipt = await this.files.request({ type: 'skills.receipt', operationId: binding.skillId });
        if (!receipt) {
          receipt = await this.files.request({
            type: 'skills.create',
            operationId: binding.skillId,
            candidate: cache.snapshot.candidate,
          });
        }
        const saved = browserSkillReceiptSchema.parse(receipt);
        if (
          saved.operationId !== binding.skillId ||
          saved.skillId !== binding.skillId ||
          saved.definitionHash !== cache.contentHash
        ) {
          throw new Error('SKILL_CONFLICT');
        }
        return await this.sessions.updateBinding(binding.recordingId, binding.skillId, (value) => {
          if (this.localCopy(value).contentHash !== cache.contentHash) {
            throw new Error('SKILL_SESSION_STALE');
          }
          value.storage = 'executor';
          value.diskSave = undefined;
        });
      } catch (error) {
        await this.sessions
          .updateBinding(binding.recordingId, binding.skillId, (value) => {
            value.diskSave = { pending: false, error: this.code(error) };
          })
          .catch(() => {});
        throw error;
      }
    }
    if (!('id' in command) || !('epoch' in command)) {
      throw new Error('SKILL_INVALID');
    }
    const session = await this.required(command.id);
    if (command.type === 'skill.answer') {
      const answered = await this.sessions.answer(command.id, command.revision, command.epoch, command);
      if (answered.accepted && answered.session.status === 'running') {
        // A fast answer may arrive while the SDK is still unwinding its external-question boundary.
        await this.closeHost(answered.session);
        await this.launch(await this.required(session.id));
      }
      return this.required(session.id);
    }
    if (session.epoch !== command.epoch) {
      throw new Error('SKILL_SESSION_STALE');
    }
    if (command.type === 'skill.resolve-unknown') {
      if (session.mode !== 'replay' || session.status !== 'outcome_unknown') {
        throw new Error('SKILL_SESSION_STALE');
      }
      const documents = new Map<string, { tabId: number; documentId: string }>();
      for (const entry of Object.values(session.ledger)) {
        if (entry.toolName !== 'browser_snapshot' || entry.result?.output.type !== 'json') {
          continue;
        }
        const input = browserParams.browser_snapshot.safeParse(entry.input);
        const output = snapshotPageSchema.safeParse(entry.result.output.value);
        if (input.success && output.success) {
          documents.set(input.data.tabId + ':' + output.data.documentId, {
            tabId: input.data.tabId,
            documentId: output.data.documentId,
          });
        }
      }
      await this.router.acknowledgeLocal(session.id, [...documents.values()], async () => {
        await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
          value.status = 'cancelled';
          value.manualResolutionAt = Date.now();
          value.epoch = crypto.randomUUID();
        });
      });
      return this.required(session.id);
    }
    if (command.type === 'skill.cancel') {
      if (['completed', 'failed', 'cancelled'].includes(session.status)) {
        return session;
      }
      await this.closeHost(session);
      const current = await this.required(session.id);
      const updated = await this.sessions.update(current.id, current.revision, current.epoch, (value) =>
        interruptSkillSession(value, true)
      );
      if (updated.mode === 'replay' && updated.status === 'outcome_unknown') {
        this.router.restoreUncertainLocal(updated.id);
      }
      await this.router.releaseLocal(session.id).catch(() => {});
      return updated;
    }
    if (command.type === 'skill.retry-save') {
      if (session.status !== 'saving' || !session.error || !session.candidate || !session.operationId) {
        throw new Error('SKILL_SESSION_STALE');
      }
      const saving = await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
        value.status = 'saving';
        value.error = undefined;
      });
      void this.save(saving).catch((error: unknown) => this.fail(saving.id, saving.epoch, error));
      return saving;
    }
    if (command.type === 'skill.extend-budget') {
      const updated = await this.sessions.update(session.id, command.revision, command.epoch, (value) =>
        extendSkillBudget(value, command.additional)
      );
      await this.launch(updated);
      return this.required(session.id);
    }
    if (command.type === 'skill.continue') {
      if (!['interrupted', 'failed'].includes(session.status)) {
        throw new Error('SKILL_SESSION_STALE');
      }
      if (
        Object.values(session.ledger).some((entry) =>
          ['unknown', 'dispatched', 'pending'].includes(entry.state)
        )
      ) {
        throw new Error('SKILL_OUTCOME_UNKNOWN');
      }
      const updated = await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
        value.status = 'running';
        if (value.error === 'SKILL_NO_TOOL') {
          value.responseRecovery = true;
        }
        value.observationRequired = value.mode === 'replay';
        delete value.error;
      });
      await this.launch(updated);
      return this.required(session.id);
    }
    throw new Error('SKILL_INVALID');
  }

  /**
   * Captures immutable input evidence or the freshly read on-disk skill before starting a new session.
   */
  private async start(
    recordingId: string,
    mode: 'organize' | 'replay',
    consent: { baseUrl: string; model: string } | undefined,
    browserCopy?: { skillId: string; contentHash: string },
    panel?: { windowId: number; documentId: string }
  ): Promise<SkillSession> {
    const existing = (await this.sessions.list(recordingId)).find(
      (item) =>
        item.mode === mode && ['running', 'waiting_user', 'saving', 'outcome_unknown'].includes(item.status)
    );
    if (existing) {
      return existing;
    }
    if (
      (await this.sessions.list()).some(
        (item) => item.windowId === panel?.windowId && ['running', 'saving'].includes(item.status)
      )
    ) {
      throw Error('SKILL_BUSY');
    }
    const configuration = modelSettingsSchema.safeParse(
      (await browser.storage.local.get('workflowSettings')).workflowSettings
    );
    if (!configuration.success) {
      throw new Error('SKILL_SETTINGS_REQUIRED');
    }
    if (
      consent &&
      (consent.baseUrl !== configuration.data.baseUrl || consent.model !== configuration.data.model)
    ) {
      throw new Error('SKILL_CONFIGURATION_CHANGED');
    }
    if (!consent && (mode === 'replay' || !(await this.settings.canSend(configuration.data.baseUrl)))) {
      throw new Error('SKILL_CONSENT_REQUIRED');
    }
    const recording = await this.recordings.get(recordingId);
    if (!recording) {
      throw new Error('SKILL_MISSING');
    }
    const session = createSkillSession({ id: crypto.randomUUID(), recordingId, name: recording.name, mode });
    if (!panel) {
      throw Error('SKILL_PANEL_REQUIRED');
    }
    session.windowId = panel.windowId;
    session.panelDocumentId = panel.documentId;
    const rawLimits = (await browser.storage.local.get('skillExecutionLimits')).skillExecutionLimits;
    const limits = rawLimits === undefined ? skillBudgetDefaults : skillBudgetSchema.parse(rawLimits);
    session.modelCallLimit = limits[mode];
    session.pageWait = { seconds: limits.pageWaitSeconds, attempts: limits.pageWaitAttempts };
    const previous = (await this.sessions.list(recordingId)).find((item) => item.mode === mode);
    if (previous && ['failed', 'interrupted'].includes(previous.status)) {
      session.retryOf = previous.id;
    }
    session.context = { settings: configuration.data };
    let expectedSkill: { skillId: string; contentHash: string } | undefined;
    if (mode === 'organize') {
      const events: RecordedEvent[] = [];
      while (events.length < recording.count) {
        const page = await this.recordings.events(recordingId, events.length);
        if (!page.length) {
          throw new Error('SKILL_INVALID');
        }
        events.push(...page);
        if (events.length > 20000) {
          throw new Error('SKILL_INVALID');
        }
      }
      session.context.evidence = prepareRecordingEvidence(recording, events);
    } else {
      const binding = await this.sessions.binding(recordingId);
      if (!binding) {
        throw new Error('SKILL_MISSING');
      }
      if (browserCopy) {
        const selected = this.localCopy(binding);
        if (browserCopy.skillId !== binding.skillId || browserCopy.contentHash !== selected.contentHash) {
          throw new Error('SKILL_SESSION_STALE');
        }
      }
      let cache = binding.cache;
      let storage: 'browser' | 'executor' | 'cached' = binding.storage;
      if (binding.storage === 'executor') {
        let snapshot;
        try {
          snapshot = browserSkillSnapshotSchema.parse(
            await this.files.request({ type: 'skills.read', skillId: binding.skillId })
          );
        } catch (error) {
          if (!['SKILL_OFFLINE', 'SKILL_FILE_OUTCOME_UNKNOWN'].includes(this.code(error))) {
            throw error;
          }
          const available = this.localCopy(binding);
          if (!browserCopy) {
            throw new Error('SKILL_CACHED_COPY_CONFIRMATION_REQUIRED', { cause: error });
          }
          if (browserCopy.skillId !== binding.skillId || browserCopy.contentHash !== available.contentHash) {
            throw new Error('SKILL_SESSION_STALE', { cause: error });
          }
          cache = available;
          storage = 'cached';
        }
        if (snapshot) {
          if (snapshot.skillId !== binding.skillId) {
            throw new Error('SKILL_CONFLICT');
          }
          const origins = new Set(recording.origins.map((origin) => new URL(origin).origin));
          if (snapshot.candidate.workflow.allowedOrigins.some((origin) => !origins.has(origin))) {
            throw new Error('SKILL_SCOPE_CHANGED');
          }
          cache = cacheSkill(snapshot);
          const fresh = cache;
          await this.sessions.updateBinding(binding.recordingId, binding.skillId, (value) => {
            value.cache = fresh;
            value.definitionHash = snapshot.definitionHash;
          });
          if (browserCopy && browserCopy.contentHash !== fresh.contentHash) {
            throw new Error('SKILL_SESSION_STALE');
          }
        }
      } else {
        cache = this.localCopy(binding);
      }
      const selected = readSkillCache(cache);

      expectedSkill = { skillId: binding.skillId, contentHash: selected.contentHash };
      session.context.skill = selected.snapshot;
      if (!session.context.skill.candidate.workflow.choices) {
        let offset = 0;
        while (offset < recording.count) {
          const events = await this.recordings.events(recordingId, offset);
          if (!events.length) {
            throw Error('SKILL_INVALID');
          }
          if (events.some(requiresNewControlCapture)) {
            throw Error('SKILL_RECORDING_SEMANTICS_REQUIRED');
          }
          offset += events.length;
        }
      }
      session.skillSource = { storage, cachedAt: selected.cachedAt };
      const recordedOrigins = new Set(recording.origins.map((origin) => new URL(origin).origin));
      if (
        session.context.skill.candidate.workflow.allowedOrigins.some((origin) => !recordedOrigins.has(origin))
      ) {
        throw new Error('SKILL_SCOPE_CHANGED');
      }
    }
    session.messages = [
      {
        role: 'user',
        content:
          mode === 'organize'
            ? '将当前选定录制整理为可复用技能。请先读取录制。'
            : '运行当前选定技能；仅执行技能目标范围，缺少本次输入时向我提问。请先读取技能。',
      },
    ];
    await this.sessions.create(session, expectedSkill);
    await this.launch(session);
    return this.required(session.id);
  }

  /**
   * Registers one SDK run in the owning panel; only explicit starts/answers/continuations create a new generation.
   */
  private async launch(session: SkillSession): Promise<void> {
    if (session.mode === 'replay') {
      if (!session.context?.skill) {
        throw new Error('SKILL_INVALID');
      }
      try {
        await this.router.claimLocal(
          session.id,
          session.context.skill.candidate.workflow.allowedOrigins,
          session.windowId,
          session.pageWait
        );
      } catch (error) {
        await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
          value.status = 'interrupted';
          value.error = this.code(error);
        });
        await this.publish();
        throw error;
      }
    }
    try {
      const panel = this.panels.get(session.panelDocumentId);
      if (!panel || panel.windowId !== session.windowId) {
        throw Error('SKILL_HOST_CLOSED');
      }
      const updated = await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
        value.epoch = crypto.randomUUID();
        value.hostWindowId = panel.windowId;
        value.hostDocumentId = panel.documentId;
        value.hostDelivered = false;
      });
      this.panels.send(panel.documentId, { type: 'panel.run', id: updated.id, epoch: updated.epoch });
      await browser.alarms.create('octopus-skills-watchdog', { periodInMinutes: 0.5 });
      await this.publish();
    } catch (error) {
      const current = await this.required(session.id);
      await this.sessions.update(current.id, current.revision, current.epoch, (value) => {
        interruptSkillSession(value);
        delete value.hostWindowId;
        delete value.hostDocumentId;
        delete value.hostDelivered;
        value.error = this.code(error);
      });
      await this.router.releaseLocal(session.id).catch(() => {});
      throw error;
    }
  }

  /**
   * Returns an ephemeral key once; prepareStep reserves each native SDK model request independently.
   */
  private async hostReady(session: SkillSession, documentId: string): Promise<unknown> {
    if (session.hostDelivered || !session.context) {
      throw new Error('SKILL_SESSION_STALE');
    }
    const settings = session.context.settings;
    const apiKey = await this.settings.resolve(settings.baseUrl);
    const updated = await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
      value.hostDocumentId = documentId;
      value.hostDelivered = true;
    });
    return {
      mode: updated.mode,
      settings,
      apiKey,
      messages: updated.messages,
      responseRecovery: updated.responseRecovery === true,
      stepTimeoutMs: session.mode === 'replay' ? pageWaitStepTimeout(session.pageWait) : 60000,
    };
  }

  /**
   * Clears registration first, then closes only the matching Host; removal callbacks cannot interrupt a successor.
   */
  private async closeHost(session: SkillSession): Promise<void> {
    if (session.hostWindowId === undefined) {
      return;
    }
    await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
      delete value.hostWindowId;
      delete value.hostDocumentId;
      delete value.hostDelivered;
    });
    try {
      this.panels.send(session.panelDocumentId, {
        type: 'panel.abort',
        id: session.id,
        epoch: session.epoch,
      });
    } catch {
      /* Document already closed. */
    }
  }

  /**
   * Commits the full SDK response and batch admission before any execute callback can dispatch effects.
   */
  private async recordStep(
    session: SkillSession,
    calls: SkillToolCall[],
    messages: SkillSession['messages'],
    finishReason: SkillFinishReason
  ) {
    calls = calls.map((call) => ({
      ...call,
      ...(call.inputIssues ? { inputIssues: safeToolIssues(call.inputIssues) } : {}),
    }));
    if (session.responses?.at(-1)?.modelCall === session.modelCalls) {
      throw Error('SKILL_SESSION_STALE');
    }
    let dispatch = false;
    let current = await this.sessions.update(session.id, session.revision, session.epoch, (value) => {
      value.sdkStep = { modelCall: value.modelCalls, start: value.messages.length };
      dispatch = recordSkillResponse(value, calls, messages, finishReason) === 'dispatch';
    });
    // Admission errors must not roll back the response that explains them.
    if (dispatch) {
      current = await this.sessions.update(current.id, current.revision, current.epoch, (value) => {
        const admission = admitSkillSessionTurn(value, calls);
        if (admission.rejected.length) {
          value.messages.push({ role: 'tool', content: admission.rejected });
          for (const rejected of admission.rejected) {
            if (rejected.output.type === 'error-text') {
              this.recordToolFailure(value, rejected.toolName, rejected.output.value);
            }
          }
        }
      });
    }
    if (!['running', 'outcome_unknown'].includes(current.status)) {
      await this.router.releaseLocal(current.id).catch(() => {});
    }
    return { status: current.status };
  }

  /**
   * Implements one SDK execute call; owns idempotence and effects, never schedules another model request.
   */
  private async executeAdmittedTool(host: SkillSession, toolCallId: string) {
    let current = await this.serial(async () => {
      const value = await this.required(host.id);
      if (value.epoch !== host.epoch || !value.hostDelivered) {
        throw Error('SKILL_SESSION_STALE');
      }
      return value;
    });
    const call = current.ledger[toolCallId];
    if (!call || call.toolName === 'ask_user_question') {
      throw Error('SKILL_TOOL_FORBIDDEN');
    }
    if (call.result) {
      return { output: call.result.output, status: current.status };
    }
    if (current.status !== 'running' || call.state !== 'pending') {
      throw Error('SKILL_TOOL_OUTCOME_PENDING');
    }
    const validation =
      call.toolName === 'submit_skill'
        ? validateSkillCandidate(call.input, current.context?.evidence, current.choiceDecisions)
        : undefined;
    if (validation && !validation.valid) {
      current = await this.serial(async () => {
        const latest = await this.required(host.id);
        return this.sessions.update(latest.id, latest.revision, host.epoch, (value) => {
          const result = skillToolResult(call, { valid: false, issues: validation.issues });
          completeSkillTool(value, call, result);
          value.messages.push({ role: 'tool', content: [result] });
          this.recordToolFailure(value, call.toolName, 'SKILL_INVALID');
        });
      });
    } else {
      current = await this.serial(async () => {
        const latest = await this.required(host.id);
        if (!this.panels.get(latest.panelDocumentId)) {
          throw Error('SKILL_HOST_CLOSED');
        }
        return this.sessions.update(latest.id, latest.revision, host.epoch, (value) => {
          dispatchSkillTool(value, toolCallId);
          if (call.toolName === 'submit_skill') {
            value.candidate = validation?.valid
              ? validation.candidate
              : browserSkillPackageSchema.parse(call.input);
            value.operationId = crypto.randomUUID();
          }
        });
      });
      await this.publish();
      try {
        if (call.toolName === 'submit_skill') {
          await this.save(current);
        } else {
          const output = await this.executeTool(current, call);
          await this.serial(async () => {
            const latest = await this.required(host.id);
            return this.sessions.update(latest.id, latest.revision, host.epoch, (value) => {
              if (
                output &&
                typeof output === 'object' &&
                'readiness' in output &&
                output.readiness &&
                typeof output.readiness === 'object' &&
                'access' in output.readiness
              ) {
                const access = pageAccessSchema.safeParse(output.readiness.access);
                if (access.success) {
                  value.pageAccess = access.data;
                  value.observationRequired = true;
                }
              }
              settleSkillTool(value, toolCallId, output);
              if (
                output &&
                typeof output === 'object' &&
                'readiness' in output &&
                output.readiness &&
                typeof output.readiness === 'object' &&
                'code' in output.readiness &&
                output.readiness.code === 'PAGE_READY_TIMEOUT'
              ) {
                value.status = 'failed';
                value.error = 'PAGE_READY_TIMEOUT';
              }
              if (call.toolName === 'finish_run') {
                if (
                  !output ||
                  typeof output !== 'object' ||
                  !('finished' in output) ||
                  output.finished !== true
                ) {
                  this.recordToolFailure(value, call.toolName, 'SKILL_CHOICE_UNRESOLVED');
                  return;
                }
                const result = z
                  .object({ summary: z.string(), outcome: z.enum(['completed', 'incomplete']) })
                  .parse(call.input);
                value.status = result.outcome === 'completed' ? 'completed' : 'failed';
                value.result = { ...result, verification: 'unverified' };
              } else if (
                call.toolName === 'validate_skill' &&
                output &&
                typeof output === 'object' &&
                'valid' in output &&
                output.valid === false
              ) {
                this.recordToolFailure(value, call.toolName, 'SKILL_INVALID');
              } else if (
                output &&
                typeof output === 'object' &&
                'status' in output &&
                ((call.toolName === 'apply_choice' && output.status !== 'satisfied') ||
                  output.status === 'choice_required')
              ) {
                this.recordToolFailure(value, call.toolName, 'SKILL_CHOICE_UNRESOLVED');
              } else {
                delete value.toolFailures?.[call.toolName];
              }
            });
          });
        }
      } catch (error) {
        if (call.toolName === 'submit_skill') {
          await this.fail(host.id, host.epoch, error);
          throw error;
        }
        const code = this.code(error);
        const unknown =
          [
            'apply_choice',
            'browser_click',
            'browser_fill',
            'browser_select',
            'browser_scroll',
            'browser_navigate',
            'browser_open_tab',
            'browser_close_tab',
          ].includes(call.toolName) &&
          ![
            'FORBIDDEN_PAGE',
            'BROWSER_BUSY',
            'TARGET_CHANGED',
            'STALE_SNAPSHOT',
            'SNAPSHOT_EXPIRED',
          ].includes(code);
        await this.serial(async () => {
          const latest = await this.required(host.id);
          return this.sessions.update(latest.id, latest.revision, host.epoch, (value) => {
            const access = error instanceof PageAccessError ? error.access : undefined;
            if (access && !unknown) {
              value.pageAccess = access;
              value.observationRequired = true;
            }
            settleSkillTool(
              value,
              toolCallId,
              { error: code, ...(access ? { access, recovery: pageAccessMessage(access) } : {}) },
              unknown
            );
            this.recordToolFailure(value, call.toolName, code);
          });
        });
        if (unknown) {
          this.router.restoreUncertainLocal(host.id);
        }
      }
      current = await this.required(host.id);
    }
    if (!['running', 'outcome_unknown'].includes(current.status)) {
      await this.router.releaseLocal(current.id).catch(() => {});
    }
    const result = current.ledger[toolCallId]?.result;
    if (!result) {
      throw Error('SKILL_TOOL_OUTCOME_PENDING');
    }
    return { output: result.output, status: current.status };
  }

  /**
   * Bounds repeated unsuccessful completion/validation attempts across observations and Host restarts.
   */
  private recordToolFailure(session: SkillSession, tool: string, code: string): void {
    if (['__proto__', 'prototype', 'constructor'].includes(tool)) {
      return;
    }
    const failures = (session.toolFailures ??= {});
    const previous = failures[tool];
    const count = previous?.code === code ? previous.count + 1 : 1;
    failures[tool] = { code, count };
    if (count >= 3 && session.status === 'running') {
      session.status = 'failed';
      session.error = 'SKILL_NO_PROGRESS';
      for (const entry of Object.values(session.ledger)) {
        if (entry.state === 'pending' && entry.toolName !== 'ask_user_question') {
          const result = skillToolResult(entry, 'SKILL_NOT_DISPATCHED', true);
          completeSkillTool(session, entry, result);
          session.messages.push({ role: 'tool', content: [result] });
        }
      }
    }
  }
  /**
   * Executes only this mode's admitted finite operation through existing owning services.
   */
  private async executeTool(session: SkillSession, call: SkillToolCall): Promise<unknown> {
    if (call.toolName === 'read_recording') {
      const { offset, limit } = z
        .object({ offset: z.number().int().min(0), limit: z.number().int().min(1).max(50) })
        .parse(call.input);
      const evidence = session.context?.evidence;
      if (!evidence) {
        throw new Error('SKILL_INVALID');
      }
      return {
        ...recordingToolPage(evidence, offset, limit),
        choices: recordingChoices(evidence, session.choiceDecisions),
      };
    }
    if (call.toolName === 'validate_skill') {
      const validation = validateSkillCandidate(
        call.input,
        session.context?.evidence,
        session.choiceDecisions
      );
      return { valid: validation.valid, issues: validation.issues };
    }
    if (call.toolName === 'read_skill') {
      const skill = session.context?.skill;
      if (!skill) {
        return null;
      }
      return {
        ...skill,
        executionChoices: applyChoiceDecisions(
          skill.candidate.workflow.choices ?? [],
          session.choiceDecisions
        ),
      };
    }
    if (call.toolName === 'finish_run') {
      const input = z
        .strictObject({
          summary: z.string().min(1).max(2000),
          outcome: z.enum(['completed', 'incomplete']),
        })
        .parse(call.input);
      if (input.outcome === 'completed') {
        if (
          applyChoiceDecisions(
            session.context?.skill?.candidate.workflow.choices ?? [],
            session.choiceDecisions
          ).some((choice) => !session.appliedChoices?.includes(choice.id))
        ) {
          return { finished: false, status: 'choice_required', next: 'apply_choice' };
        }
        // Evidence identity belongs to the runtime, never to a model-inferred snapshot UUID.
        const evidenceCallId = !session.observationRequired
          ? session.lastObservationCallId
          : session.lastMutationCallId;
        const evidence = evidenceCallId ? session.ledger[evidenceCallId] : undefined;
        if (!evidence || evidence.state !== 'completed' || evidence.result?.output.type !== 'json') {
          throw new Error('SKILL_OBSERVATION_REQUIRED');
        }
        const ordinaryObservation =
          !session.observationRequired && session.lastObservationCallId === evidenceCallId;
        const closedTab =
          evidence.toolName === 'browser_close_tab' &&
          session.lastMutationCallId === evidenceCallId &&
          evidence.result.output.value &&
          typeof evidence.result.output.value === 'object' &&
          'businessEffect' in evidence.result.output.value &&
          evidence.result.output.value.businessEffect === 'applied';
        if (!ordinaryObservation && !closedTab) {
          throw new Error('SKILL_OBSERVATION_REQUIRED');
        }
      }
      return {
        finished: true,
        outcome: input.outcome,
        verification: 'unverified',
        evidenceCallId: session.observationRequired
          ? (session.lastMutationCallId ?? null)
          : (session.lastObservationCallId ?? null),
      };
    }
    if (
      (!Object.hasOwn(browserParams, call.toolName) && call.toolName !== 'apply_choice') ||
      session.mode !== 'replay'
    ) {
      throw new Error('SKILL_TOOL_FORBIDDEN');
    }
    const method = call.toolName as BrowserMethod | 'apply_choice';
    let params: unknown;
    if (method === 'apply_choice') {
      const input = applyChoiceParams.parse(call.input);
      const observed = session.lastObservationCallId
        ? session.ledger[session.lastObservationCallId]
        : undefined;
      const snapshot =
        observed?.result?.output.type === 'json'
          ? snapshotPageSchema.safeParse(observed.result.output.value)
          : undefined;
      const tab = observed ? browserParams.browser_snapshot.safeParse(observed.input) : undefined;
      if (
        !snapshot?.success ||
        !tab?.success ||
        tab.data.tabId !== input.tabId ||
        session.observationRequired
      ) {
        return { status: 'observation_required', businessEffect: 'none', next: 'browser_snapshot' };
      }
      params = {
        ...input,
        documentId: snapshot.data.documentId,
        controllerId: snapshot.data.controllerId,
        snapshotId: snapshot.data.snapshotId,
      };
    } else {
      params = browserParams[method].parse(call.input);
    }
    if (
      method === 'browser_snapshot' &&
      params &&
      typeof params === 'object' &&
      'screenshot' in params &&
      params.screenshot
    ) {
      throw new Error('SKILL_TOOL_FORBIDDEN');
    }
    const reply = await this.router.executeLocal(
      {
        type: 'request',
        requestId: crypto.randomUUID(),
        taskId: session.id,
        localRunId: session.id,
        method,
        params,
        choiceRequirements: applyChoiceDecisions(
          session.context?.skill?.candidate.workflow.choices ?? [],
          session.choiceDecisions
        ),
      },
      async (progress) => {
        // Progress is display metadata, never a new model turn or permission to resume an old generation.
        try {
          await this.serial(async () => {
            const current = await this.sessions.get(session.id);
            if (
              !current ||
              current.epoch !== session.epoch ||
              current.status !== 'running' ||
              current.ledger[call.toolCallId]?.state !== 'dispatched'
            ) {
              return;
            }
            await this.sessions.update(current.id, current.revision, current.epoch, (value) => {
              value.ledger[call.toolCallId]!.waitProgress = progress;
            });
          });
          await this.publish();
        } catch {
          // A failed UI notification must not turn an acknowledged tab operation into an unknown effect.
        }
      }
    );
    if (reply && typeof reply === 'object' && 'error' in reply) {
      throw new Error(String(reply.error));
    }
    const value = reply && typeof reply === 'object' && 'result' in reply ? reply.result : reply;
    if (
      value &&
      typeof value === 'object' &&
      'businessEffect' in value &&
      value.businessEffect === 'unknown'
    ) {
      throw new Error('OUTCOME_UNKNOWN');
    }
    return value;
  }

  /**
   * Saves the candidate locally without depending on Native availability or requesting another model turn.
   */
  private async save(session: SkillSession): Promise<void> {
    if (!session.candidate || !session.operationId) {
      throw new Error('SKILL_INVALID');
    }
    const snapshot = {
      skillId: session.operationId,
      definitionHash: skillContentHash(session.candidate),
      candidate: session.candidate,
    };
    const current = await this.required(session.id);
    if (current.epoch !== session.epoch || current.status === 'completed') {
      return;
    }
    await this.sessions.bindSaved(current.id, current.revision, current.epoch, {
      recordingId: current.recordingId,
      sessionId: current.id,
      skillId: snapshot.skillId,
      definitionHash: snapshot.definitionHash,
      savedAt: Date.now(),
      storage: 'browser',
      cache: cacheSkill(snapshot),
    });
  }

  /**
   * Verifies the copy belongs to this association; corrupted copies never become a fallback.
   */
  private localCopy(binding: RecordingSkillBinding) {
    const cache = readSkillCache(binding.cache);
    if (cache.snapshot.skillId !== binding.skillId) {
      throw new Error('SKILL_NO_BROWSER_COPY');
    }
    return cache;
  }

  /**
   * Retains candidates and unknown effects when asynchronous work fails after the caller has returned.
   */
  private async fail(id: string, epoch: string, error: unknown): Promise<void> {
    const current = await this.sessions.get(id);
    if (
      !current ||
      current.epoch !== epoch ||
      ['cancelled', 'completed', 'waiting_user', 'outcome_unknown', 'failed'].includes(current.status)
    ) {
      return;
    }
    const failed = await this.sessions
      .update(id, current.revision, epoch, (value) => {
        value.error = this.code(error);
        if (value.candidate) {
          value.status = 'saving';
        } else if (
          Object.values(value.ledger).some(
            (entry) =>
              entry.toolName.startsWith('browser_') && ['dispatched', 'unknown'].includes(entry.state)
          )
        ) {
          interruptSkillSession(value);
        } else {
          value.status = 'failed';
        }
      })
      .catch(() => undefined);
    if (failed?.status === 'outcome_unknown' && failed.mode === 'replay') {
      this.router.restoreUncertainLocal(failed.id);
    } else if (failed && ['failed', 'interrupted'].includes(failed.status)) {
      await this.router.releaseLocal(failed.id).catch(() => {});
    }
  }

  /**
   * Converts a lost or expired registered Host to an explicit interrupted state, never an automatic retry.
   */
  check(): void {
    void this.serial(async () => {
      await this.initialize();
      for (const session of await this.sessions.list()) {
        if (session.hostWindowId === undefined) {
          continue;
        }
        const panel = this.panels.get(session.panelDocumentId);
        const hostTimeout =
          session.mode === 'replay' ? Math.max(90000, pageWaitStepTimeout(session.pageWait) + 30000) : 90000;
        if (panel && Date.now() - session.updatedAt < hostTimeout) {
          continue;
        }
        await this.closeHost(session);
        const current = await this.required(session.id);
        await this.sessions.update(current.id, current.revision, current.epoch, (value) => {
          interruptSkillSession(value);
          value.error = 'SKILL_HOST_CLOSED';
        });
        await this.router.releaseLocal(current.id).catch(() => {});
      }
    }).catch(() => {});
  }
}
