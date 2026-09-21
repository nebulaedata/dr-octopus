/**
 * @author Codex
 * @description Projects the pinned rpiv ask_user_question RPC fallback into a versioned Host questionnaire contract.
 */

import type { RpcExtensionUIResponse } from '@earendil-works/pi-coding-agent';
import type { HostAgentEvent } from './types.js';

const RPIV_PACKAGE = '@juicesharp/rpiv-ask-user-question';
const RPIV_VERSION = '2.7.1';
const RPIV_TOOL_NAME = 'ask_user_question';

interface RpivOption {
  label: string;
  description: string;
}

interface RpivQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: RpivOption[];
}

interface RpivQuestionnaireProjection {
  adapter: 'rpiv-ask-user-question';
  package: typeof RPIV_PACKAGE;
  version: typeof RPIV_VERSION;
  toolCallId: string;
  questionIndex: number;
  multiple: boolean;
  header: string;
  title: string;
  options: Array<{ id: string; label: string; description: string }>;
  responseEncoding: 'rpiv-rpc-v1';
}

interface RpivFlow {
  disabled: boolean;
  pendingRequestId?: string;
  questionIndex: number;
  questions: RpivQuestion[];
  toolCallId: string;
  waitingForCustomInput: boolean;
}

/**
 * Validates the exact question structure consumed by rpiv 2.7.1 without interpreting display text.
 */
function parseRpivQuestions(value: unknown): RpivQuestion[] | undefined {
  const args = asRecord(value);
  const rawQuestions = args?.['questions'];
  if (!Array.isArray(rawQuestions) || rawQuestions.length < 1 || rawQuestions.length > 4) {
    return undefined;
  }
  const questions: RpivQuestion[] = [];
  for (const rawQuestion of rawQuestions) {
    const question = asRecord(rawQuestion);
    const options = question?.['options'];
    if (
      typeof question?.['question'] !== 'string' ||
      typeof question['header'] !== 'string' ||
      !Array.isArray(options) ||
      options.length < 2 ||
      options.length > 4 ||
      (question['multiSelect'] !== undefined && typeof question['multiSelect'] !== 'boolean')
    ) {
      return undefined;
    }
    const parsedOptions: RpivOption[] = [];
    for (const rawOption of options) {
      const option = asRecord(rawOption);
      if (typeof option?.['label'] !== 'string' || typeof option['description'] !== 'string') {
        return undefined;
      }
      parsedOptions.push({ label: option['label'], description: option['description'] });
    }
    questions.push({
      question: question['question'],
      header: question['header'],
      multiSelect: question['multiSelect'] === true,
      options: parsedOptions,
    });
  }
  return questions;
}

/**
 * Narrows an unknown value to a JSON object record.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Narrows an unknown JSON value to an array of strings.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

interface PendingDialog {
  flow: RpivFlow;
  generationKey: string;
  kind: 'single' | 'multi' | 'custom';
  rawOptions?: string[];
}

/**
 * Correlates rpiv tool execution and Extension UI events only while one flow is unambiguous.
 */
export class RpivQuestionnaireAdapter {
  readonly #flows = new Map<string, Map<string, RpivFlow>>();
  readonly #pending = new Map<string, PendingDialog>();
  readonly #generationBySession = new Map<string, string>();

  /**
   * Records tool lifecycle events before an Extension UI request is projected.
   */
  public observe(event: HostAgentEvent): void {
    const generationKey = this.#activateGeneration(event);
    const payload = asRecord(event.payload);
    if (event.type !== 'agent-event' || payload === undefined) {
      return;
    }
    const eventType = payload['type'];
    const toolCallId = typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : undefined;
    if (toolCallId === undefined) {
      return;
    }
    if (eventType === 'tool_execution_start' && payload['toolName'] === RPIV_TOOL_NAME) {
      const questions = parseRpivQuestions(payload['args']);
      if (questions === undefined) {
        return;
      }
      const flows = this.#flows.get(generationKey) ?? new Map<string, RpivFlow>();
      const flow: RpivFlow = {
        disabled: flows.size > 0,
        questionIndex: 0,
        questions,
        toolCallId,
        waitingForCustomInput: false,
      };
      if (flows.size > 0) {
        for (const existing of flows.values()) {
          existing.disabled = true;
        }
      }
      flows.set(toolCallId, flow);
      this.#flows.set(generationKey, flows);
      return;
    }
    if (eventType === 'tool_execution_end') {
      this.#removeFlow(generationKey, toolCallId);
    }
  }

  /**
   * Attaches structured questionnaire metadata when the RPC request matches exactly one expected rpiv step.
   */
  public project(event: HostAgentEvent): unknown {
    const generationKey = this.#activateGeneration(event);
    const payload = asRecord(event.payload);
    if (event.type !== 'extension-ui' || payload === undefined) {
      return event.payload;
    }
    const id = typeof payload['id'] === 'string' ? payload['id'] : undefined;
    const method = typeof payload['method'] === 'string' ? payload['method'] : undefined;
    if (id === undefined || method === undefined) {
      return event.payload;
    }
    const candidates = [...(this.#flows.get(generationKey)?.values() ?? [])].filter(
      (flow) => !flow.disabled && flow.pendingRequestId === undefined
    );
    if (candidates.length !== 1) {
      return event.payload;
    }
    const flow = candidates[0];
    const question = flow?.questions[flow.questionIndex];
    if (flow === undefined || question === undefined) {
      return event.payload;
    }
    const kind = flow.waitingForCustomInput ? 'custom' : question.multiSelect ? 'multi' : 'single';
    const expectedMethod = kind === 'single' ? 'select' : 'input';
    if (method !== expectedMethod) {
      return event.payload;
    }
    const rawOptions =
      kind === 'single' && isStringArray(payload['options']) ? payload['options'] : undefined;
    if (kind === 'single' && rawOptions?.length !== question.options.length + 1) {
      return event.payload;
    }
    flow.pendingRequestId = id;
    this.#pending.set(this.#pendingKey(event.sessionId, id), {
      flow,
      generationKey,
      kind,
      ...(rawOptions === undefined ? {} : { rawOptions }),
    });
    if (kind !== 'multi') {
      return event.payload;
    }
    return {
      ...payload,
      hostQuestionnaire: {
        adapter: 'rpiv-ask-user-question',
        package: RPIV_PACKAGE,
        version: RPIV_VERSION,
        toolCallId: flow.toolCallId,
        questionIndex: flow.questionIndex,
        multiple: question.multiSelect,
        header: question.header,
        title: question.question,
        options: question.options.map((option, index) => ({ id: String(index), ...option })),
        responseEncoding: 'rpiv-rpc-v1',
      } satisfies RpivQuestionnaireProjection,
    };
  }

  /**
   * Advances the matched questionnaire only after Pi accepts the exact dialog response.
   */
  public resolve(sessionId: string, response: RpcExtensionUIResponse): void {
    const key = this.#pendingKey(sessionId, response.id);
    const pending = this.#pending.get(key);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(key);
    pending.flow.pendingRequestId = undefined;
    if ('cancelled' in response && response.cancelled) {
      this.#removeFlow(pending.generationKey, pending.flow.toolCallId);
      return;
    }
    if (pending.kind === 'single') {
      const value = 'value' in response ? response.value : undefined;
      const selectedIndex = value === undefined ? -1 : (pending.rawOptions?.indexOf(value) ?? -1);
      if (selectedIndex < 0) {
        pending.flow.disabled = true;
        return;
      }
      if (selectedIndex === pending.flow.questions[pending.flow.questionIndex]?.options.length) {
        pending.flow.waitingForCustomInput = true;
        return;
      }
    }
    pending.flow.questionIndex += 1;
    pending.flow.waitingForCustomInput = false;
  }

  /**
   * Discards questionnaire state owned by a terminated Agent process generation.
   *
   * @param sessionId Stable Web Session identity.
   */
  public reset(sessionId: string): void {
    const generationKey = this.#generationBySession.get(sessionId);
    if (generationKey !== undefined) {
      this.#clearGeneration(generationKey, sessionId);
    }
    this.#generationBySession.delete(sessionId);
  }

  /**
   * Releases every generation-scoped correlation record.
   */
  public close(): void {
    this.#flows.clear();
    this.#pending.clear();
    this.#generationBySession.clear();
  }

  /**
   * Fences state by runtime generation and removes stale state after replacement or recovery.
   */
  #activateGeneration(event: HostAgentEvent): string {
    const generationKey = `${event.runtimeId}:${event.epoch}`;
    const previous = this.#generationBySession.get(event.sessionId);
    if (previous !== undefined && previous !== generationKey) {
      this.#clearGeneration(previous, event.sessionId);
    }
    this.#generationBySession.set(event.sessionId, generationKey);
    return generationKey;
  }

  /**
   * Removes one completed or cancelled questionnaire flow and its pending dialog.
   */
  #removeFlow(generationKey: string, toolCallId: string): void {
    const flows = this.#flows.get(generationKey);
    const flow = flows?.get(toolCallId);
    if (flow?.pendingRequestId !== undefined) {
      for (const [key, pending] of this.#pending) {
        if (pending.flow === flow) {
          this.#pending.delete(key);
        }
      }
    }
    flows?.delete(toolCallId);
    if (flows?.size === 0) {
      this.#flows.delete(generationKey);
    }
  }

  /**
   * Clears all state belonging to one obsolete process generation.
   */
  #clearGeneration(generationKey: string, sessionId: string): void {
    this.#flows.delete(generationKey);
    for (const [key, pending] of this.#pending) {
      if (pending.generationKey === generationKey || key.startsWith(`${sessionId}:`)) {
        this.#pending.delete(key);
      }
    }
  }

  /**
   * Creates a Session-scoped pending request key.
   */
  #pendingKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }
}
