/**
 * @author Codex
 * @description Preserves completed model turns and distinguishes recoverable narration from empty, truncated or refused output.
 */
import { z } from 'zod';
import {
  completeSkillTool,
  skillToolResult,
  interruptSkillSession,
  responseRecoveryLimit,
  type SkillSession,
  type SkillToolCall,
} from './skill-session';
export const skillFinishReasonSchema = z.enum([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
]);
export type SkillFinishReason = z.infer<typeof skillFinishReasonSchema>;
export type SkillResponseSummary = {
  modelCall: number;
  epoch: string;
  finishReason: SkillFinishReason;
  toolCallCount: number;
  textLength: number;
  reasoningLength: number;
  classification: 'tools' | 'text_only' | 'empty' | 'truncated' | 'filtered' | 'provider_error' | 'unknown';
  recovery: boolean;
};

/**
 * Records before deciding. Text-only replies never complete a task or execute a browser operation.
 */
export function recordSkillResponse(
  session: SkillSession,
  calls: SkillToolCall[],
  messages: SkillSession['messages'],
  finishReason: SkillFinishReason
): 'dispatch' | 'recover' | 'fail' {
  if (session.status !== 'running') {
    throw Error('SKILL_SESSION_STALE');
  }
  let textLength = 0;
  let reasoningLength = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      textLength += message.content.trim().length;
    } else {
      for (const part of message.content) {
        if (part.type === 'text') {
          textLength += part.text.trim().length;
        } else if (part.type === 'reasoning') {
          reasoningLength += part.text.trim().length;
        }
      }
    }
  }
  const classification: SkillResponseSummary['classification'] =
    finishReason === 'length'
      ? 'truncated'
      : finishReason === 'content-filter'
        ? 'filtered'
        : finishReason === 'error'
          ? 'provider_error'
          : finishReason === 'other'
            ? 'unknown'
            : calls.length
              ? 'tools'
              : textLength
                ? 'text_only'
                : 'empty';
  session.messages.push(...messages);
  (session.responses ??= []).push({
    modelCall: session.modelCalls,
    epoch: session.epoch,
    finishReason,
    toolCallCount: calls.length,
    textLength,
    reasoningLength,
    classification,
    recovery: session.responseRecovery === true,
  });
  if (
    Object.values(session.ledger).some((entry) => entry.state === 'unknown' || entry.state === 'dispatched')
  ) {
    interruptSkillSession(session);
    session.error = 'SKILL_OUTCOME_UNKNOWN';
    return 'fail';
  }
  if (classification === 'tools') {
    // Organization has no page operations: a valid tool request restores its normal compile flow.
    if (session.mode === 'organize' && calls.some((call) => !call.invalid)) {
      session.responseRecovery = false;
    }
    return 'dispatch';
  }
  if (classification === 'text_only' && (session.responseRecoveryCalls ?? 0) < responseRecoveryLimit) {
    session.responseRecovery = true;
    return 'recover';
  }
  const codes = {
    text_only: 'SKILL_RESPONSE_RECOVERY_EXHAUSTED',
    empty: 'MODEL_EMPTY_RESPONSE',
    truncated: 'MODEL_OUTPUT_TRUNCATED',
    filtered: 'MODEL_RESPONSE_FILTERED',
    provider_error: 'MODEL_RESPONSE_ERROR',
    unknown: 'MODEL_FINISH_UNKNOWN',
  };
  session.error = codes[classification];
  session.status = 'failed';
  // A parsed call in a truncated/refused response is not executable. Pair it with an explicit non-execution result.
  for (const call of calls) {
    const previous = session.ledger[call.toolCallId]?.result;
    const result = previous ?? skillToolResult(call, 'SKILL_RESPONSE_NOT_EXECUTED', true);
    if (!previous) {
      completeSkillTool(session, call, result);
    }
    session.messages.push({ role: 'tool', content: [result] });
  }
  return 'fail';
}
