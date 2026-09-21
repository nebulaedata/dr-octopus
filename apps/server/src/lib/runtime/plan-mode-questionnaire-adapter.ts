/**
 * @author Codex
 * @description Projects pi-plan-mode 0.55.3 sequential RPC selections into a versioned Host questionnaire contract.
 */

import type { RpcExtensionUIResponse } from '@earendil-works/pi-coding-agent';
import type { HostAgentEvent } from './types.js';

const PLAN_PACKAGE = '@narumitw/pi-plan-mode';
const PLAN_VERSION = '0.55.3';
const PLAN_QUESTION_TOOL = 'plan_mode_question';

interface PlanQuestion {
  id: string;
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
}

interface PlanFlow {
  disabled: boolean;
  pendingRequestId?: string;
  questionIndex: number;
  questions: PlanQuestion[];
  toolCallId: string;
  waitingForCustomInput: boolean;
}

interface PendingDialog {
  flow: PlanFlow;
  generationKey: string;
  kind: 'select' | 'custom';
  rawOptions?: string[];
}

/**
 * Correlates the pinned Plan tool lifecycle with its sequential Extension UI requests.
 */
export class PlanModeQuestionnaireAdapter {
  readonly #flows = new Map<string, Map<string, PlanFlow>>();
  readonly #pending = new Map<string, PendingDialog>();
  readonly #generationBySession = new Map<string, string>();

  /**
   * Records Plan question tool lifecycle events before UI projection.
   */
  public observe(event: HostAgentEvent): void {
    const generationKey = this.#activateGeneration(event);
    const payload = asRecord(event.payload);
    if (event.type !== 'agent-event' || payload === undefined) {
      return;
    }
    const toolCallId = typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : undefined;
    if (toolCallId === undefined) {
      return;
    }
    if (payload['type'] === 'tool_execution_start' && payload['toolName'] === PLAN_QUESTION_TOOL) {
      const questions = parseQuestions(payload['args']);
      if (questions === undefined) {
        return;
      }
      const flows = this.#flows.get(generationKey) ?? new Map<string, PlanFlow>();
      for (const flow of flows.values()) {
        flow.disabled = true;
      }
      flows.set(toolCallId, {
        disabled: flows.size > 0,
        questionIndex: 0,
        questions,
        toolCallId,
        waitingForCustomInput: false,
      });
      this.#flows.set(generationKey, flows);
      return;
    }
    if (payload['type'] === 'tool_execution_end') {
      this.#removeFlow(generationKey, toolCallId);
    }
  }

  /**
   * Adds structured Plan question copy when exactly one flow owns the RPC request.
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
    const expectedMethod = flow.waitingForCustomInput ? 'editor' : 'select';
    if (method !== expectedMethod) {
      return event.payload;
    }
    const rawOptions = method === 'select' && isStringArray(payload['options']) ? payload['options'] : undefined;
    if (method === 'select' && rawOptions?.length !== question.options.length + 1) {
      return event.payload;
    }
    flow.pendingRequestId = id;
    this.#pending.set(this.#pendingKey(event.sessionId, id), {
      flow,
      generationKey,
      kind: method === 'select' ? 'select' : 'custom',
      ...(rawOptions === undefined ? {} : { rawOptions }),
    });
    if (method !== 'select') {
      return event.payload;
    }
    return {
      ...payload,
      hostQuestionnaire: {
        adapter: 'pi-plan-mode',
        package: PLAN_PACKAGE,
        version: PLAN_VERSION,
        toolCallId: flow.toolCallId,
        questionIndex: flow.questionIndex,
        multiple: false,
        header: question.header,
        title: question.question,
        options: question.options.map((option, index) => ({ id: String(index), ...option })),
        responseEncoding: 'pi-tui-kit-select-v1',
      },
    };
  }

  /**
   * Advances the flow only after the originating runtime accepts its response.
   */
  public resolve(sessionId: string, response: RpcExtensionUIResponse): void {
    const pending = this.#pending.get(this.#pendingKey(sessionId, response.id));
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(this.#pendingKey(sessionId, response.id));
    pending.flow.pendingRequestId = undefined;
    if ('cancelled' in response && response.cancelled) {
      this.#removeFlow(pending.generationKey, pending.flow.toolCallId);
      return;
    }
    if (pending.kind === 'select') {
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
   * Clears state owned by one Session's obsolete runtime generation.
   */
  public reset(sessionId: string): void {
    const generationKey = this.#generationBySession.get(sessionId);
    if (generationKey !== undefined) {
      this.#clearGeneration(generationKey, sessionId);
    }
    this.#generationBySession.delete(sessionId);
  }

  /**
   * Releases all correlation state.
   */
  public close(): void {
    this.#flows.clear();
    this.#pending.clear();
    this.#generationBySession.clear();
  }

  /**
   * Fences correlation state by runtime identity and epoch.
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
   * Removes one completed or cancelled Plan questionnaire flow.
   */
  #removeFlow(generationKey: string, toolCallId: string): void {
    const flows = this.#flows.get(generationKey);
    const flow = flows?.get(toolCallId);
    for (const [key, pending] of this.#pending) {
      if (pending.flow === flow) {
        this.#pending.delete(key);
      }
    }
    flows?.delete(toolCallId);
    if (flows?.size === 0) {
      this.#flows.delete(generationKey);
    }
  }

  /**
   * Clears all records associated with one obsolete process generation.
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
   * Builds a stable Session-scoped RPC request key.
   */
  #pendingKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }
}

/**
 * Parses the exact bounded question structure accepted by pi-plan-mode 0.55.3.
 */
function parseQuestions(value: unknown): PlanQuestion[] | undefined {
  const rawQuestions = asRecord(value)?.['questions'];
  if (!Array.isArray(rawQuestions) || rawQuestions.length < 1 || rawQuestions.length > 3) {
    return undefined;
  }
  const questions: PlanQuestion[] = [];
  for (const candidate of rawQuestions) {
    const question = asRecord(candidate);
    const rawOptions = question?.['options'];
    if (
      typeof question?.['id'] !== 'string' ||
      typeof question['header'] !== 'string' ||
      typeof question['question'] !== 'string' ||
      !Array.isArray(rawOptions) ||
      rawOptions.length < 2 ||
      rawOptions.length > 4
    ) {
      return undefined;
    }
    const options: PlanQuestion['options'] = [];
    for (const candidateOption of rawOptions) {
      const option = asRecord(candidateOption);
      if (typeof option?.['label'] !== 'string' || typeof option['description'] !== 'string') {
        return undefined;
      }
      options.push({ label: option['label'], description: option['description'] });
    }
    questions.push({
      id: question['id'],
      header: question['header'],
      question: question['question'],
      options,
    });
  }
  return questions;
}

/**
 * Narrows an unknown value to an object record.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Checks the RPC option list without changing any wire values.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
