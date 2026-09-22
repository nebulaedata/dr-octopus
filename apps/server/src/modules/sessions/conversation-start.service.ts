/**
 * @author Codex
 * @description Owns cold first-message admission, current model resolution, durable acceptance and non-replaying delivery.
 */
import { ConversationModelsService } from './conversation-models.service.js';
import { responseData } from '../../lib/runtime/index.js';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type {
  ConversationStartDto,
  ConversationStartInput,
  ModelSelection,
  ConversationStartStatus,
} from '@octopus/shared/protocol';
import type { ConversationStartRepository } from './conversation-start.repository.js';
import type { SessionsService } from './sessions.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { ChannelService } from '../channel/channel.service.js';
import type { AttachmentsService } from '../attachments/attachments.service.js';

type Row = NonNullable<ReturnType<ConversationStartRepository['get']>>;
export interface ConversationStartDependencies {
  repository: ConversationStartRepository;
  sessions: SessionsService;
  settings: SettingsService;
  channel: ChannelService;
  attachments: AttachmentsService;
  /**
   * Refreshes effective configuration, including external changes, and returns its revision.
   */
  configuration(): Promise<string>;
  /**
   * Validates Workspace ownership before any operation is claimed.
   */
  assertWorkspace(id: string): Promise<unknown>;
  /**
   * Publishes a committed status invalidation without exposing transport to the workflow.
   */
  onChanged?(workspaceId: string): void;
}

/**
 * Projects only non-secret operation status to the browser.
 */
function project(row: Row): ConversationStartDto {
  return {
    submissionId: row.submissionId,
    sessionId: row.sessionId,
    status: row.status,
    message: row.request.message,
    ...(['failed', 'cancelled'].includes(row.status) ? { draft: row.request } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

export class ConversationStartService {
  readonly #models: ConversationModelsService;
  readonly #pending = new Map<string, Promise<void>>();
  #closed = false;
  /**
   * Recovers persisted operations conservatively before accepting new submissions.
   */
  constructor(private readonly deps: ConversationStartDependencies) {
    this.#models = new ConversationModelsService(deps.settings, () => deps.configuration());
    deps.repository.recover();
    for (const row of deps.repository.accepted()) {
      const recovery = this.#resumeAccepted(row).finally(() => this.#pending.delete(row.submissionId));
      this.#pending.set(row.submissionId, recovery);
    }
  }

  /**
   * Owns status writes and their after-write hints for every workflow exit path.
   */
  #transition(id: string, status: ConversationStartStatus, error?: string): void {
    this.deps.repository.set(id, status, error);
    const row = this.deps.repository.get(id);
    if (row) {
      this.#notify(row.workspaceId);
    }
  }

  /**
   * Notification failures cannot roll back a durable submission.
   */
  #notify(workspaceId: string): void {
    try {
      this.deps.onChanged?.(workspaceId);
    } catch {
      /* Reconnect reads authoritative state. */
    }
  }

  /**
   * Reads the Host catalog without activating a Session.
   */
  catalog() {
    return this.#models.catalog();
  }

  /**
   * Resolves the draft's current model-selection intent.
   */
  resolve(selection: ModelSelection) {
    return this.#models.resolve(selection);
  }

  /**
   * Claims a durable, idempotent first submission and returns immediately while preparation runs.
   */
  async start(workspaceId: string, input: ConversationStartInput) {
    if (this.#closed) {
      throw new ApplicationError('CONVERSATION_START_CLOSED', 'Conversation preparation is unavailable.', {
        statusCode: 503,
      });
    }
    await this.deps.assertWorkspace(workspaceId);
    if (this.#pending.size >= 64 && !this.deps.repository.get(input.submissionId)) {
      throw new ApplicationError(
        'SESSION_DRAFT_CAPACITY',
        'Too many prepared conversations. Try again later.',
        { statusCode: 429 }
      );
    }
    const row = this.deps.repository.claim(workspaceId, input);
    this.#notify(workspaceId);
    if (row.status === 'preparing' && !this.#pending.has(row.submissionId)) {
      const task = this.#run(row).finally(() => this.#pending.delete(row.submissionId));
      this.#pending.set(row.submissionId, task);
    }
    return project(this.deps.repository.get(row.submissionId)!);
  }

  /**
   * Returns saved status after reload or a lost HTTP response, without replaying work.
   */
  get(workspaceId: string, id: string) {
    const row = this.deps.repository.get(id);
    if (!row || row.workspaceId !== workspaceId) {
      throw new ApplicationError('CONVERSATION_START_NOT_FOUND', 'Conversation submission was not found.', {
        statusCode: 404,
      });
    }
    return project(row);
  }

  /**
   * Exposes saved first-message content when RPC delivery cannot be confirmed.
   */
  receipt(workspaceId: string, sessionId: string) {
    const row = this.deps.repository.forSession(workspaceId, sessionId);
    return row ? project(row) : null;
  }

  /**
   * Cancellation only wins before durable acceptance; later requests return authoritative status.
   */
  cancel(workspaceId: string, id: string) {
    if (this.get(workspaceId, id).status === 'preparing') {
      this.#transition(id, 'cancelled');
    }
    return this.get(workspaceId, id);
  }

  /**
   * Delivers a durable outbox item only when no prior RPC dispatch could have happened.
   */
  async #resumeAccepted(row: Row): Promise<void> {
    try {
      const session = this.deps.sessions.getSession(row.sessionId);
      if (!session.provider || !session.model) {
        throw new Error('Accepted model is unavailable.');
      }
      const selected = await this.resolve({
        mode: 'explicit',
        provider: session.provider,
        modelId: session.model,
      });
      const binding = await this.deps.sessions.activate(row.sessionId);
      await this.deps.sessions.executeThinkingControl(
        row.sessionId,
        { type: 'set_model', provider: selected.provider, modelId: selected.id },
        binding
      );
      await this.#applyControls(row, binding);
      const message = {
        type: 'agent.prompt' as const,
        requestId: row.submissionId,
        sessionId: row.sessionId,
        runtimeId: binding.runtimeId,
        epoch: binding.epoch,
        payload: {
          message: row.request.message,
          attachmentIds: row.request.attachmentIds,
          workspaceReferences: row.request.workspaceReferences,
        },
      };
      const command = await this.deps.channel.prepareFirstMessage(message);
      if (this.#closed) {
        return;
      }
      this.#transition(row.submissionId, 'dispatching');
      await this.deps.channel.dispatchFirstMessage(message, command);
      if (!this.#closed) {
        this.#transition(row.submissionId, 'running');
      }
    } catch {
      if (!this.#closed) {
        this.#transition(
          row.submissionId,
          'unknown',
          'Recovery could not confirm delivery. Inspect the conversation before sending again.'
        );
      }
    }
  }

  /**
   * Applies first-turn intent after readiness, including recovery of an accepted operation.
   */
  async #applyControls(row: Row, binding: { runtimeId: string; epoch: number }): Promise<void> {
    const sessions = this.deps.sessions;
    if (row.request.controls?.permissionMode) {
      await sessions.executePermissionControl(row.sessionId, row.request.controls.permissionMode, binding);
    }
    if (row.request.controls?.thinkingLevel) {
      const result = await sessions.executeThinkingControl(
        row.sessionId,
        { type: 'set_thinking_level', level: row.request.controls.thinkingLevel },
        binding
      );
      if (result.level !== row.request.controls.thinkingLevel) {
        throw new Error('The model does not support the selected thinking level.');
      }
    }
    const mode = row.request.controls?.workMode;
    if (mode) {
      await sessions.executeWorkModeControl(
        row.sessionId,
        mode,
        binding,
        mode === 'knowledge' ? (row.request.controls?.knowledge ?? { collectionIds: [] }) : undefined
      );
    }
  }

  /**
   * Prepares one fresh process and fences config changes before accepting the first message.
   */
  async #run(row: Row): Promise<void> {
    const { sessions, repository, attachments } = this.deps;
    let accepted = false;
    let created = false;
    const deadline = setTimeout(() => {
      if (repository.get(row.submissionId)?.status === 'preparing') {
        this.#transition(row.submissionId, 'cancelled', 'Preparation timed out. Retry your saved draft.');
      }
    }, 120_000);
    deadline.unref();
    try {
      const revision = await this.deps.configuration();
      const model = await this.resolve(row.request.selection);
      if (this.#closed || repository.get(row.submissionId)?.status !== 'preparing') {
        return;
      }
      const draft = await sessions.prepareDraftSession(row.workspaceId, row.sessionId);
      created = true;
      if (this.#closed || repository.get(row.submissionId)?.status !== 'preparing') {
        return;
      }
      const binding = draft.runtime!;
      await sessions.executeThinkingControl(
        row.sessionId,
        { type: 'set_model', provider: model.provider, modelId: model.id },
        binding
      );
      await this.#applyControls(row, binding);
      const effective = responseData<{ model?: { provider: string; id: string } }>(
        await sessions.execute(row.sessionId, { type: 'get_state' }, binding)
      );
      if (effective?.model?.provider !== model.provider || effective.model.id !== model.id) {
        throw new Error('The runtime did not adopt the selected model.');
      }
      const message = {
        type: 'agent.prompt' as const,
        requestId: row.submissionId,
        sessionId: row.sessionId,
        runtimeId: binding.runtimeId,
        epoch: binding.epoch,
        payload: {
          message: row.request.message,
          attachmentIds: row.request.attachmentIds,
          workspaceReferences: row.request.workspaceReferences,
        },
      };
      const command = await this.deps.channel.prepareFirstMessage(message);
      if (revision !== (await this.deps.configuration())) {
        throw new Error('Configuration changed during preparation. Retry your saved draft.');
      }
      if (repository.get(row.submissionId)?.status !== 'preparing') {
        return;
      }
      // No await between the final check and publication: both metadata writes share one SQLite commit.
      repository.database.db.transaction(() => {
        sessions.publishDraftSession(row.sessionId, row.request.message.slice(0, 80));
        repository.set(row.submissionId, 'accepted');
      });
      accepted = true;
      this.#transition(row.submissionId, 'dispatching');
      await this.deps.channel.dispatchFirstMessage(message, command);
      if (!this.#closed) {
        this.#transition(row.submissionId, 'running');
      }
    } catch {
      if (this.#closed) {
        return;
      }
      if (repository.get(row.submissionId)?.status !== 'cancelled') {
        this.#transition(
          row.submissionId,
          accepted ? 'unknown' : 'failed',
          accepted
            ? 'Delivery could not be confirmed. Inspect the conversation before sending again.'
            : 'Could not start the conversation. Check the model configuration and retry your saved draft.'
        );
      }
    } finally {
      clearTimeout(deadline);
      if (!accepted && !this.#closed) {
        attachments.releasePrompt(row.submissionId);
        if (created) {
          await sessions.deleteSession(row.sessionId, { deleteFiles: true }).catch(() => undefined);
        }
      }
    }
  }

  /**
   * Stops new admissions and lets owned preparations settle before dependencies shut down.
   */
  async close() {
    this.#closed = true;
    for (const id of this.#pending.keys()) {
      const row = this.deps.repository.get(id);
      if (row?.status === 'preparing') {
        this.#transition(id, 'cancelled');
        this.deps.attachments.releasePrompt(id);
      }
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(this.#pending.values()),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
    clearTimeout(timer);
  }
}
