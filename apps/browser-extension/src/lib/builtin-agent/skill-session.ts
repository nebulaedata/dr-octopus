/**
 * @author Codex
 * @description Owns durable agent transitions, budgets and external-tool admission independently of browser transport.
 */
import type { ModelMessage, ToolResultPart } from 'ai';
import type { PageAccessIssue } from '../../page-access';
import type { PageWaitPolicy, PageWaitProgress } from '../../page-wait-policy';
import { z } from 'zod';
import { snapshotPageSchema } from '@octopus/shared/protocol/browser-tools';
import type { BrowserSkillPackage, BrowserSkillSnapshot } from '@octopus/shared/protocol/browser-skills';
import type { ModelSettings } from '../model-settings/model-settings-messages';
import type { RecordingEvidence } from '../recording/recording-evidence';
import { skillModelLimit, skillBudgetDefaults, skillBudgetMaximum } from './skill-budget';
import { skillQuestionSchema, validateSkillAnswer, type SkillQuestion } from './skill-question';
import { recordingChoices, type ChoiceDecisions } from '../recording/recording-choices';

export const replayRecoveryTools = [
  'read_skill',
  'browser_tabs',
  'browser_read_snapshot',
  'browser_snapshot',
  'ask_user_question',
  'finish_run',
] as const;
export const responseRecoveryLimit = 2;

/**
 * Returns the same recovery capability set used by SDK discovery and durable tool admission.
 */
export function pageRecoveryTools(access?: PageAccessIssue): string[] | undefined {
  if (!access) {
    return undefined;
  }
  if (access.reason === 'permission') {
    return ['ask_user_question', 'finish_run'];
  }
  return [
    'read_skill',
    'browser_tabs',
    'browser_open_tab',
    'browser_navigate',
    'browser_snapshot',
    'ask_user_question',
    'finish_run',
  ];
}

export type SkillToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  invalid?: boolean;
  inputIssues?: import('./skill-tool-diagnostic').SkillToolIssue[];
};
export type SkillToolEntry = SkillToolCall & {
  waitProgress?: PageWaitProgress;
  state: 'pending' | 'dispatched' | 'completed' | 'unknown';
  result?: ToolResultPart;
  presentedQuestion?: SkillQuestion;
};
export type SkillSession = {
  id: string;
  recordingId: string;
  retryOf?: string;
  name: string;
  mode: 'organize' | 'replay';
  revision: number;
  epoch: string;
  status:
    | 'running'
    | 'waiting_user'
    | 'saving'
    | 'interrupted'
    | 'outcome_unknown'
    | 'completed'
    | 'failed'
    | 'cancelled';
  createdAt: number;
  updatedAt: number;
  modelCalls: number;
  responseRecovery?: boolean;
  responseRecoveryCalls?: number;
  responses?: import('./skill-response').SkillResponseSummary[];
  modelCallLimit?: number;
  toolCalls: number;
  toolFailures?: Record<string, { code: string; count: number }>;
  sdkStep?: { modelCall: number; start: number };
  questions: number;
  messages: ModelMessage[];
  ledger: Record<string, SkillToolEntry>;
  pendingQuestion?: { toolCallId: string; question: SkillQuestion };
  answers: Record<string, { toolCallId: string; signature: string }>;
  choiceDecisions?: ChoiceDecisions;
  appliedChoices?: string[];
  observationRequired: boolean;
  pageAccess?: PageAccessIssue;
  pageWait?: PageWaitPolicy;
  lastObservationCallId?: string;
  lastMutationCallId?: string;
  error?: string;
  manualResolutionAt?: number;
  context?: { settings: ModelSettings; evidence?: RecordingEvidence; skill?: BrowserSkillSnapshot };
  windowId?: number;
  panelDocumentId?: string;
  hostWindowId?: number;
  hostDocumentId?: string;
  hostDelivered?: boolean;
  candidate?: BrowserSkillPackage;
  operationId?: string;
  localSkillFiles?: boolean;
  skillSource?: { storage: 'browser' | 'executor' | 'cached'; cachedAt: number };
  result?: { summary: string; verification: 'unverified'; outcome: 'completed' | 'incomplete' };
};

/**
 * Creates a task without invoking models or acquiring page resources.
 */
export function createSkillSession(
  input: Pick<SkillSession, 'id' | 'recordingId' | 'name' | 'mode'>,
  now = Date.now()
): SkillSession {
  return {
    ...input,
    revision: 0,
    epoch: crypto.randomUUID(),
    status: 'running',
    createdAt: now,
    updatedAt: now,
    modelCalls: 0,
    localSkillFiles: false,
    modelCallLimit: skillBudgetDefaults[input.mode],
    toolCalls: 0,
    questions: 0,
    messages: [],
    ledger: {},
    answers: {},
    observationRequired: input.mode === 'replay',
  };
}

/**
 * Preserves the exact call identity when an external tool receives its result.
 */
export function skillToolResult(call: SkillToolCall, value: unknown, error = false): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: error
      ? { type: 'error-text', value: String(value) }
      : { type: 'json', value: z.json().parse(value) },
  };
}

/**
 * Rejects stale hosts before reserving a request; restarts never reset cumulative budgets.
 */
export function reserveSkillModelCall(session: SkillSession, epoch: string): void {
  if (session.epoch !== epoch || session.status !== 'running') {
    throw new Error('SKILL_SESSION_STALE');
  }
  const limit = skillModelLimit(session);
  if (session.modelCalls >= limit) {
    throw new Error('SKILL_MODEL_BUDGET');
  }
  if (
    Object.values(session.ledger).some((entry) => entry.state === 'unknown' || entry.state === 'dispatched')
  ) {
    throw Error('SKILL_OUTCOME_UNKNOWN');
  }
  if (session.responseRecovery) {
    if ((session.responseRecoveryCalls ?? 0) >= responseRecoveryLimit) {
      throw Error('SKILL_RESPONSE_RECOVERY_EXHAUSTED');
    }
    session.responseRecoveryCalls = (session.responseRecoveryCalls ?? 0) + 1;
  }
  session.modelCalls++;
}

/**
 * Records a completed result once; unknown/dispatched effects cannot be silently replaced.
 */
export function completeSkillTool(session: SkillSession, call: SkillToolCall, result: ToolResultPart): void {
  if (result.toolCallId !== call.toolCallId || result.toolName !== call.toolName) {
    throw new Error('SKILL_TOOL_CALL_CONFLICT');
  }
  const existing = session.ledger[call.toolCallId];
  if (existing?.result) {
    if (JSON.stringify(existing.result) !== JSON.stringify(result)) {
      throw new Error('SKILL_TOOL_CALL_CONFLICT');
    }
    return;
  }
  session.ledger[call.toolCallId] = { ...call, state: 'completed', result };
}

/**
 * Admits only unfinished external calls after an entire turn, giving questions priority over all effects.
 * The caller commits this mutation before displaying the question or dispatching the returned effect.
 */
export function admitSkillSessionTurn(
  session: SkillSession,
  calls: SkillToolCall[]
): { effect?: SkillToolCall; rejected: ToolResultPart[] } {
  if (session.status !== 'running') {
    throw new Error('SKILL_SESSION_STALE');
  }
  const seen = new Set<string>();
  const allowed =
    session.mode === 'organize'
      ? ['read_recording', 'validate_skill', 'submit_skill']
      : [
          'apply_choice',
          'read_skill',
          'browser_tabs',
          'browser_read_snapshot',
          'browser_snapshot',
          'browser_click',
          'browser_fill',
          'browser_select',
          'browser_scroll',
          'browser_open_tab',
          'browser_close_tab',
          'browser_navigate',
          'finish_run',
        ];
  const pending: SkillToolCall[] = [];
  for (const call of calls) {
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(call.toolCallId) ||
      ['__proto__', 'constructor', 'prototype'].includes(call.toolCallId) ||
      seen.has(call.toolCallId)
    ) {
      throw new Error('SKILL_TOOL_CALL_CONFLICT');
    }
    seen.add(call.toolCallId);
    const previous = session.ledger[call.toolCallId];
    if (previous) {
      if (
        previous.toolName !== call.toolName ||
        JSON.stringify(previous.input) !== JSON.stringify(call.input)
      ) {
        throw new Error('SKILL_TOOL_CALL_CONFLICT');
      }
      if (previous.state !== 'completed') {
        throw new Error('SKILL_TOOL_OUTCOME_PENDING');
      }
      continue;
    }
    pending.push(call);
  }
  if (session.toolCalls + pending.length > skillModelLimit(session) * 2) {
    throw new Error('SKILL_TOOL_BUDGET');
  }
  session.toolCalls += pending.length;
  const hasQuestion = pending.some((call) => call.toolName === 'ask_user_question');
  const result: { effect?: SkillToolCall; rejected: ToolResultPart[] } = { rejected: [] };
  for (const call of pending) {
    let error: string | undefined;
    if (
      session.responseRecovery &&
      session.mode === 'replay' &&
      !replayRecoveryTools.some((name) => name === call.toolName)
    ) {
      error = 'SKILL_RECOVERY_ACTION_BLOCKED';
    } else if (call.invalid) {
      error = 'SKILL_TOOL_INPUT_INVALID';
    } else if (
      session.pageAccess &&
      (!pageRecoveryTools(session.pageAccess)?.includes(call.toolName) ||
        (call.toolName === 'finish_run' &&
          (call.input as { outcome?: string } | null)?.outcome !== 'incomplete'))
    ) {
      error = 'SKILL_ACCESS_RECOVERY_REQUIRED';
    } else if (call.toolName === 'ask_user_question') {
      const question = skillQuestionSchema.safeParse(call.input);
      if (!question.success) {
        error = 'SKILL_TOOL_INPUT_INVALID';
      } else if (session.pendingQuestion) {
        error = 'SKILL_QUESTION_ALREADY_PENDING';
      } else if (session.questions >= 5) {
        error = 'SKILL_QUESTION_BUDGET';
      } else {
        const decision = question.data.choiceDecision;
        if (decision) {
          const requirements =
            session.mode === 'organize'
              ? recordingChoices(session.context?.evidence)
              : (session.context?.skill?.candidate.workflow.choices ?? []);
          const requirement = requirements.find((choice) => choice.id === decision.requirementId);
          if (
            !requirement ||
            (decision.operation === 'set' &&
              (requirement.control.role === 'select') !== Array.isArray(decision.state))
          ) {
            const rejected = skillToolResult(call, 'SKILL_CHOICE_DECISION_INVALID', true);
            completeSkillTool(session, call, rejected);
            result.rejected.push(rejected);
            continue;
          }
          let change = session.mode === 'organize' ? '从技能中删除此选择要求' : '在本次重放中跳过此选择要求';
          if (decision.operation === 'set') {
            let display: string;
            if (Array.isArray(decision.state)) {
              display = JSON.stringify(decision.state);
            } else {
              display = decision.state ? '选中' : '取消选中';
            }
            change = `将选择结果设为「${display}」`;
          }
          if (change.length > 270) {
            const rejected = skillToolResult(call, 'SKILL_CHOICE_DECISION_INVALID', true);
            completeSkillTool(session, call, rejected);
            result.rejected.push(rejected);
            continue;
          }
          question.data.question = `是否${change}？`;
          question.data.reason = `仅影响选择：${requirement.control.group} / ${requirement.control.label}。不同意时保留原要求。${session.mode === 'replay' ? '仅本次生效，不修改技能文件。' : ''}`;
          question.data.fields = [
            {
              id: 'approve',
              label: '是否同意此项变更',
              type: 'single',
              required: true,
              options: [
                { id: 'yes', label: '同意' },
                { id: 'no', label: '不同意' },
              ],
            },
          ];
          question.data.allowDefer = false;
        }
        session.pendingQuestion = { toolCallId: call.toolCallId, question: question.data };
        session.questions++;
        session.status = 'waiting_user';
      }
    } else if (!allowed.includes(call.toolName)) {
      error = 'SKILL_TOOL_FORBIDDEN';
    } else if (hasQuestion) {
      error = 'SKILL_USER_ANSWER_REQUIRED';
    } else if (result.effect) {
      error = 'SKILL_OBSERVE_BEFORE_NEXT_ACTION';
    } else if (
      session.observationRequired &&
      ![
        'browser_snapshot',
        'browser_tabs',
        'browser_open_tab',
        'browser_navigate',
        'read_skill',
        'finish_run',
      ].includes(call.toolName) &&
      session.mode === 'replay'
    ) {
      error = 'SKILL_OBSERVATION_REQUIRED';
    } else {
      result.effect = call;
    }
    if (error) {
      const rejected = skillToolResult(call, error, true);
      completeSkillTool(session, call, rejected);
      result.rejected.push(rejected);
    } else {
      session.ledger[call.toolCallId] = {
        ...call,
        state: 'pending',
        ...(call.toolName === 'ask_user_question' && session.pendingQuestion?.toolCallId === call.toolCallId
          ? { presentedQuestion: structuredClone(session.pendingQuestion.question) }
          : {}),
      };
    }
  }
  return result;
}

/**
 * Answers exactly the current question and pairs it with its original SDK tool call.
 */
export function answerSkillSession(
  session: SkillSession,
  input: { submissionId: string; toolCallId: string; answer: unknown }
): boolean {
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.submissionId) ||
    ['__proto__', 'constructor', 'prototype'].includes(input.submissionId)
  ) {
    throw new Error('SKILL_ANSWER_INVALID');
  }
  const signature = JSON.stringify(input.answer);
  const previous = session.answers[input.submissionId];
  if (previous) {
    if (previous.toolCallId !== input.toolCallId || previous.signature !== signature) {
      throw new Error('SKILL_ANSWER_CONFLICT');
    }
    return false;
  }
  const pending = session.pendingQuestion;
  if (session.status !== 'waiting_user' || !pending || pending.toolCallId !== input.toolCallId) {
    throw new Error('SKILL_QUESTION_STALE');
  }
  const answer = validateSkillAnswer(pending.question, input.answer);
  const decision = pending.question.choiceDecision;
  if (decision && answer.status === 'answered' && answer.values.approve === 'yes') {
    (session.choiceDecisions ??= {})[decision.requirementId] =
      decision.operation === 'omit' ? { omit: true } : { state: decision.state };
    session.appliedChoices = session.appliedChoices?.filter((id) => id !== decision.requirementId);
  }
  const call = session.ledger[input.toolCallId];
  if (!call || call.state !== 'pending') {
    throw new Error('SKILL_TOOL_CALL_CONFLICT');
  }
  const result = skillToolResult(call, answer);
  completeSkillTool(session, call, result);
  session.messages.push({ role: 'tool', content: [result] });
  session.answers[input.submissionId] = { toolCallId: input.toolCallId, signature };
  delete session.pendingQuestion;
  session.status = 'running';
  session.responseRecovery = false;
  session.observationRequired = session.mode === 'replay';
  return true;
}

/**
 * Marks an admitted effect before dispatch; a second delivery cannot execute it again.
 */
export function dispatchSkillTool(session: SkillSession, toolCallId: string): SkillToolCall {
  if (session.status !== 'running') {
    throw new Error('SKILL_SESSION_STALE');
  }
  const entry = session.ledger[toolCallId];
  if (!entry || entry.state !== 'pending' || entry.toolName === 'ask_user_question') {
    throw new Error('SKILL_TOOL_OUTCOME_PENDING');
  }
  entry.state = 'dispatched';
  if (entry.toolName === 'submit_skill') {
    session.status = 'saving';
  }
  return { toolCallId: entry.toolCallId, toolName: entry.toolName, input: entry.input };
}

/**
 * Stores the actual effect result and invalidates observations after page actions.
 */
export function settleSkillTool(
  session: SkillSession,
  toolCallId: string,
  value: unknown,
  unknown = false
): void {
  const entry = session.ledger[toolCallId];
  if (!entry || entry.state !== 'dispatched') {
    throw new Error('SKILL_TOOL_OUTCOME_PENDING');
  }
  const result = skillToolResult(entry, value);
  completeSkillTool(session, entry, result);
  if (
    entry.toolName === 'apply_choice' &&
    !unknown &&
    value &&
    typeof value === 'object' &&
    'status' in value &&
    value.status === 'satisfied' &&
    'requirementId' in value &&
    typeof value.requirementId === 'string'
  ) {
    session.appliedChoices = [...new Set([...(session.appliedChoices ?? []), value.requirementId])];
  }
  session.messages.push({ role: 'tool', content: [result] });
  if (unknown) {
    const completed = session.ledger[toolCallId];
    if (!completed) {
      throw new Error('SKILL_TOOL_CALL_CONFLICT');
    }
    completed.state = 'unknown';
    session.status = 'outcome_unknown';
  }
  if (entry.toolName === 'browser_snapshot' && snapshotPageSchema.safeParse(value).success && !unknown) {
    delete session.pageAccess;
    session.observationRequired = false;
    session.lastObservationCallId = toolCallId;
  } else if (
    [
      'apply_choice',
      'browser_click',
      'browser_fill',
      'browser_select',
      'browser_scroll',
      'browser_navigate',
      'browser_open_tab',
      'browser_close_tab',
    ].includes(entry.toolName)
  ) {
    session.observationRequired = true;
    session.lastMutationCallId = toolCallId;
  }
}

/**
 * Freezes uncertain effects on restart or cancellation instead of treating them as not executed.
 */
export function interruptSkillSession(session: SkillSession, cancelled = false): void {
  let unknown = false;
  const reads = new Set([
    'read_recording',
    'read_skill',
    'validate_skill',
    'browser_tabs',
    'browser_read_snapshot',
    'browser_snapshot',
  ]);
  for (const entry of Object.values(session.ledger)) {
    if (entry.state === 'pending' && entry.toolName !== 'ask_user_question') {
      const result = skillToolResult(entry, 'SKILL_NOT_DISPATCHED', true);
      completeSkillTool(session, entry, result);
      session.messages.push({ role: 'tool', content: [result] });
      continue;
    }
    if (entry.state === 'dispatched' || entry.state === 'unknown') {
      if (reads.has(entry.toolName)) {
        if (!entry.result) {
          const result = skillToolResult(entry, 'SKILL_INTERRUPTED_READ', true);
          completeSkillTool(session, entry, result);
          session.messages.push({ role: 'tool', content: [result] });
        } else {
          entry.state = 'completed';
        }
        continue;
      }
      entry.state = 'unknown';
      unknown = true;
    }
  }
  session.epoch = crypto.randomUUID();
  session.observationRequired = session.mode === 'replay';
  if (unknown) {
    session.status = 'outcome_unknown';
  } else if (cancelled) {
    session.status = 'cancelled';
  } else if (session.status === 'running') {
    session.status = 'interrupted';
  }
}

/**
 * Adds an explicitly confirmed allowance only to an exhausted settled session; completed effects are never reset.
 */
export function extendSkillBudget(session: SkillSession, additional: number): void {
  if (
    session.status !== 'failed' ||
    !['SKILL_MODEL_BUDGET', 'SKILL_TOOL_BUDGET'].includes(session.error ?? '') ||
    session.hostWindowId !== undefined ||
    session.pendingQuestion ||
    Object.values(session.ledger ?? {}).some((entry) =>
      ['pending', 'dispatched', 'unknown'].includes(entry.state)
    )
  ) {
    throw new Error('SKILL_SESSION_STALE');
  }
  const next = Math.max(skillModelLimit(session), session.modelCalls) + additional;
  if (!Number.isInteger(additional) || additional < 1 || additional > 100 || next > skillBudgetMaximum) {
    throw new Error('SKILL_BUDGET_LIMIT');
  }
  session.modelCallLimit = next;
  session.epoch = crypto.randomUUID();
  session.status = 'running';
  session.observationRequired = session.mode === 'replay';
  delete session.error;
}

/**
 * Keeps active execution and uncertain page effects inspectable until they have been stopped or resolved.
 */
export function skillDeletionBlock(session: SkillSession): string | undefined {
  if (
    session.status === 'outcome_unknown' ||
    Object.values(session.ledger ?? {}).some((entry) => entry.state === 'unknown')
  ) {
    return '请先核实执行结果，再删除会话。';
  }
  if (
    ['running', 'saving'].includes(session.status) ||
    session.hostWindowId !== undefined ||
    Object.values(session.ledger ?? {}).some(
      (entry) =>
        entry.state === 'dispatched' || (entry.state === 'pending' && entry.toolName !== 'ask_user_question')
    )
  ) {
    return '请先停止执行，再删除会话。';
  }
  return undefined;
}
