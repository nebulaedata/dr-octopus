/**
 * @author Codex
 * @description Executes one scheduled snapshot in a dedicated Pi RPC process and isolated Session directory.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { permissionEvidence } from './permission-evidence.js';
import { executionDigest } from '../services/execution-digest.js';
import { AgentRpcProcess } from '../../../rpc/rpc-process.js';
import type { SchedulerRunner, SchedulerRunCallbacks } from '../definitions/runner.js';
import type { SchedulerExecutionWork, SchedulerRunOutcome } from '../definitions/work.js';

type RunProcess = Pick<
  AgentRpcProcess,
  'start' | 'stop' | 'execute' | 'onEvent' | 'onLifecycle' | 'getLastSessionState' | 'respondToExtensionUi'
>;
type RunProcessFactory = (
  work: SchedulerExecutionWork,
  sessionId: string,
  sessionDirectory: string
) => RunProcess;

/**
 * Extract a bounded summary without invoking another model or exposing transport diagnostics.
 */
function summary(text: string | null, outcome: SchedulerRunOutcome): string {
  const value = text?.trim();
  return (outcome.summary || value || `Scheduled run ${outcome.status}.`).slice(0, 4000);
}

/**
 * Locate the exact user prompt marker even when a fast model has already advanced the Session leaf.
 */
function findPromptEntry(entries: unknown, runId: string): string | null {
  if (!Array.isArray(entries)) {
    return null;
  }
  const values: unknown[] = entries;
  const marker = `runId: ${runId}`;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const entry: unknown = values[index];
    if (
      entry !== null &&
      typeof entry === 'object' &&
      (entry as { type?: unknown }).type === 'message' &&
      (entry as { message?: { role?: unknown } }).message?.role === 'user' &&
      JSON.stringify((entry as { message?: { content?: unknown } }).message?.content).includes(marker) &&
      typeof (entry as { id?: unknown }).id === 'string'
    ) {
      return (entry as { id: string }).id;
    }
  }
  return null;
}

/**
 * Own one process per Run; the daemon owns capacity and durable state transitions.
 */
export class AgentSchedulerRunner implements SchedulerRunner {
  /**
   * Build production RPC processes lazily so importing task control does not load or start Pi.
   */
  constructor(
    private readonly agentDir: string,
    private readonly schedulerDirectory: string,
    private readonly processFactory: RunProcessFactory = (work, sessionId, sessionDirectory) =>
      new AgentRpcProcess({
        workspace: { id: work.workspaceId, cwd: work.cwd },
        agentDir,
        sessionId,
        sessionDir: sessionDirectory,
        childEnvironment: {
          // 每次运行创建独立进程：禁用 Scheduler 管理扩展，并要求核验下面的持久授权。
          DR_OCTOPUS_PROCESS_ROLE: 'scheduled-task',
          DR_OCTOPUS_PERMISSION_EXECUTION: JSON.stringify({
            profileId: this.profileId,
            subjectId: work.taskId,
            workspaceId: work.workspaceId,
            executionDigest: executionDigest(work),
            sessionId,
            attemptId: work.attemptId,
            cwd: work.cwd,
            ref: work.authorizationRef ?? null,
            inspect: false,
          }),
        },
        settleTimeoutMs: 5000,
        stopTimeoutMs: 3000,
      }),
    private readonly profileId: string = ''
  ) {}

  /**
   * Resolve on settle, permission request, timeout, cancellation or exact process loss.
   */
  async run(
    work: SchedulerExecutionWork,
    signal: AbortSignal,
    callbacks: SchedulerRunCallbacks
  ): Promise<SchedulerRunOutcome> {
    const sessionId = randomUUID();
    const sessionDirectory = join(this.schedulerDirectory, 'runs', work.runId);
    const process = this.processFactory(work, sessionId, sessionDirectory);
    let dispatched = false;
    let started = false;
    let failed = false;
    let outcome: SchedulerRunOutcome | undefined;
    let resolveOutcome!: (value: SchedulerRunOutcome) => void;
    const settled = new Promise<SchedulerRunOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const finish = (value: SchedulerRunOutcome): void => {
      if (!outcome) {
        outcome = value;
        resolveOutcome(value);
      }
    };
    const unsubscribeEvent = process.onEvent((event) => {
      if (event.type === 'extension_ui_request') {
        if (['select', 'confirm', 'input', 'editor', 'custom'].includes(event.method)) {
          finish({
            status: 'needs_attention',
            summary: 'Scheduled run requires interactive input.',
            errorCode: 'SCHEDULE_INPUT_REQUIRED',
          });
          void process.respondToExtensionUi({ type: 'extension_ui_response', id: event.id, cancelled: true });
        }
        return;
      }
      if (event.type === 'agent_start') {
        started = true;
      }
      if (
        event.type === 'message_end' &&
        'message' in event &&
        event.message.role === 'assistant' &&
        ['error', 'aborted'].includes(event.message.stopReason)
      ) {
        failed = true;
      }
      if (event.type === 'agent_settled' && started) {
        finish({
          status: failed ? 'failed' : 'succeeded',
          summary: '',
          errorCode: failed ? 'SCHEDULE_AGENT_FAILED' : null,
        });
      }
    });
    const unsubscribeLifecycle = process.onLifecycle((event) => {
      if (event.type === 'unexpected-exit') {
        finish({
          status: dispatched ? 'interrupted' : 'failed',
          summary: dispatched
            ? 'Scheduled execution was interrupted after dispatch.'
            : 'Scheduled execution could not start.',
          errorCode: dispatched ? 'SCHEDULE_EXECUTION_INTERRUPTED' : 'SCHEDULE_ACTIVATION_FAILED',
        });
      }
    });
    const onAbort = (): void =>
      finish({
        status: 'cancelled',
        summary: 'Scheduled run was cancelled.',
        errorCode: 'SCHEDULE_EXECUTION_CANCELLED',
      });
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(
      () =>
        finish({
          status: 'timed_out',
          summary: 'Scheduled run exceeded its execution deadline.',
          errorCode: 'SCHEDULE_EXECUTION_TIMEOUT',
        }),
      work.timeoutMs
    );
    try {
      signal.throwIfAborted();
      await process.start();
      if (outcome || signal.aborted) {
        return (
          outcome ?? {
            status: 'cancelled',
            summary: 'Scheduled run was cancelled.',
            errorCode: 'SCHEDULE_EXECUTION_CANCELLED',
          }
        );
      }
      const authorization = await process.execute({ type: 'get_entries' });
      const ready =
        authorization.command === 'get_entries'
          ? permissionEvidence(authorization.data.entries, sessionId, work.attemptId)
          : undefined;
      if (!ready?.ready) {
        return {
          status: !ready || ready.code?.includes('UNAVAILABLE') ? 'failed' : 'needs_attention',
          summary: ready?.reason ?? 'Permission initialization did not complete.',
          errorCode: ready?.code ?? 'SCHEDULE_AUTHORIZATION_UNAVAILABLE',
        };
      }
      const state = process.getLastSessionState();
      if (!state?.sessionFile || state.sessionId !== sessionId) {
        throw new Error('Isolated Session evidence is unavailable');
      }
      if (!callbacks.dispatch({ sessionId, sessionPath: state.sessionFile })) {
        throw new Error('Run dispatch barrier was rejected');
      }
      dispatched = true;
      await process.execute({
        type: 'prompt',
        message: [
          '[Octopus Scheduler Run]',
          `runId: ${work.runId}`,
          `taskId: ${work.taskId}`,
          `scheduledFor: ${work.scheduledFor}`,
          '',
          `Actual execution time: ${new Date().toISOString()}. Local date/time (${work.timezone ?? 'UTC'}): ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeStyle: 'long', timeZone: work.timezone ?? 'UTC' }).format(new Date())}. This is an unattended run; do not request user input or use shell just to determine the date.`,
          work.prompt,
        ].join('\n'),
      });
      const entries = await process.execute({ type: 'get_entries' });
      const promptEntryId =
        entries.command === 'get_entries' ? findPromptEntry(entries.data.entries, work.runId) : null;
      if (!promptEntryId || !callbacks.running(promptEntryId)) {
        throw new Error('Prompt entry evidence was not persisted');
      }
      let terminal = await settled;
      const permissionEntries = await process.execute({ type: 'get_entries' }).catch(() => undefined);
      const evidence =
        permissionEntries?.command === 'get_entries'
          ? permissionEvidence(permissionEntries.data.entries, sessionId, work.attemptId)
          : undefined;
      if (evidence && !evidence.ready && ['succeeded', 'failed'].includes(terminal.status)) {
        terminal = {
          status: evidence.code?.includes('UNAVAILABLE') ? 'failed' : 'needs_attention',
          summary: [
            evidence.reason ?? 'Task authorization failed.',
            evidence.toolName ? `Tool: ${evidence.toolName}` : '',
            evidence.requestId ? `Request: ${evidence.requestId}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          errorCode: evidence.code ?? 'SCHEDULE_PERMISSION_DENIED',
        };
      }
      if (['timed_out', 'needs_attention', 'cancelled'].includes(terminal.status)) {
        await process.execute({ type: 'abort' }).catch(() => undefined);
      }
      let finalText: string | null = null;
      if (terminal.status === 'succeeded' || terminal.status === 'failed') {
        const response = await process.execute({ type: 'get_last_assistant_text' }).catch(() => undefined);
        if (response?.command === 'get_last_assistant_text') {
          finalText = response.data.text;
        }
      }
      return { ...terminal, summary: summary(finalText, terminal) };
    } catch {
      return (
        outcome ?? {
          status: dispatched ? 'interrupted' : 'failed',
          summary: dispatched
            ? 'Scheduled execution was interrupted after dispatch.'
            : 'Scheduled execution could not start.',
          errorCode: dispatched ? 'SCHEDULE_EXECUTION_INTERRUPTED' : 'SCHEDULE_ACTIVATION_FAILED',
        }
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      unsubscribeEvent();
      unsubscribeLifecycle();
      await process.stop().catch(() => undefined);
    }
  }
}
