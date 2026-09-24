/**
 * @author Codex
 * @description Defensively projects pi-plan-mode 0.55.3 question and completion tool contracts.
 */

import { isRecord, readString } from '@/features/session/utils/tool-renderer-utils';
import type { ToolProjection } from '@/stores/session';

export interface PlanModeOptionProjection {
  label: string;
  description?: string;
}

export interface PlanModeQuestionProjection {
  id: string;
  header: string;
  question: string;
  options: PlanModeOptionProjection[];
  answer?: string;
  wasCustom?: boolean;
  note?: string;
}

export interface PlanModeToolProjection {
  plan?: string;
  questions: PlanModeQuestionProjection[];
  cancelled: boolean;
  reason?: string;
}

/**
 * Reads only the pinned package's versioned details and bounded questionnaire arguments.
 *
 * @param tool Browser Tool projection.
 * @returns Stable presentation fields for Plan tool renderers.
 */
export function projectPlanModeTool(tool: ToolProjection): PlanModeToolProjection {
  if (tool.name === 'plan_mode_complete') {
    const details = isRecord(tool.details) ? tool.details : {};
    const plan =
      details['version'] === 1 && details['source'] === 'plan_mode_complete'
        ? readBoundedString(details['plan'], 50_000)
        : undefined;
    return { ...(plan === undefined ? {} : { plan }), questions: [], cancelled: false };
  }
  const details = isRecord(tool.details) ? tool.details : {};
  const argumentsRecord = isRecord(tool.arguments) ? tool.arguments : {};
  const questions = readQuestions(details['questions'] ?? argumentsRecord['questions']);
  const answers = readAnswers(details['answers']);
  return {
    questions: questions.map((question) => ({ ...question, ...answers.get(question.id) })),
    cancelled: details['cancelled'] === true,
    ...(readString(details, 'reason') === undefined ? {} : { reason: readString(details, 'reason') }),
  };
}

/**
 * Builds compact labels without parsing model-facing text output.
 *
 * @param tool Browser Tool projection.
 * @returns Plan-specific collapsed summary.
 */
export function summarizePlanModeTool(tool: ToolProjection): string | undefined {
  const projection = projectPlanModeTool(tool);
  if (tool.name === 'plan_mode_complete') {
    return projection.plan === undefined ? undefined : 'Proposed plan ready';
  }
  if (projection.cancelled) {
    return 'Question cancelled';
  }
  const answered = projection.questions.filter((question) => question.answer !== undefined).length;
  if (answered > 0) {
    return `${String(answered)} answered`;
  }
  return projection.questions.length === 0
    ? undefined
    : `${String(projection.questions.length)} awaiting response`;
}

/**
 * Validates the bounded array accepted by plan_mode_question.
 *
 * @param value Candidate questions collection.
 * @returns Safe questions in source order.
 */
function readQuestions(value: unknown): PlanModeQuestionProjection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    return [];
  }
  return value.flatMap((candidate): PlanModeQuestionProjection[] => {
    if (!isRecord(candidate) || !Array.isArray(candidate['options'])) {
      return [];
    }
    const id = readBoundedString(candidate['id'], 128);
    const header = readBoundedString(candidate['header'], 128);
    const question = readBoundedString(candidate['question'], 2_000);
    const options = readOptions(candidate['options']);
    return id === undefined || header === undefined || question === undefined || options.length < 2
      ? []
      : [{ id, header, question, options }];
  });
}

/**
 * Validates Plan question options without accepting arbitrary nested result data.
 *
 * @param value Candidate options collection.
 * @returns Safe display options.
 */
function readOptions(value: unknown[]): PlanModeOptionProjection[] {
  if (value.length < 2 || value.length > 4) {
    return [];
  }
  return value.flatMap((candidate): PlanModeOptionProjection[] => {
    if (!isRecord(candidate)) {
      return [];
    }
    const label = readBoundedString(candidate['label'], 256);
    const description = readBoundedString(candidate['description'], 1_000);
    return label === undefined ? [] : [{ label, ...(description === undefined ? {} : { description }) }];
  });
}

/**
 * Indexes the package's completed answers by stable question id.
 *
 * @param value Candidate answers collection.
 * @returns Valid answer fragments keyed by question id.
 */
function readAnswers(
  value: unknown
): Map<string, Pick<PlanModeQuestionProjection, 'answer' | 'wasCustom' | 'note'>> {
  const answers = new Map<string, Pick<PlanModeQuestionProjection, 'answer' | 'wasCustom' | 'note'>>();
  if (!Array.isArray(value) || value.length > 3) {
    return answers;
  }
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }
    const id = readBoundedString(candidate['id'], 128);
    const answer = readBoundedString(candidate['answer'], 4_000);
    if (id === undefined || answer === undefined || answers.has(id)) {
      continue;
    }
    const note = readBoundedString(candidate['note'], 4_000);
    answers.set(id, {
      answer,
      wasCustom: candidate['wasCustom'] === true,
      ...(note === undefined ? {} : { note }),
    });
  }
  return answers;
}

/**
 * Reads one non-empty bounded string.
 *
 * @param value Candidate value.
 * @param maximum Maximum accepted characters.
 * @returns Trimmed string when valid.
 */
function readBoundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : undefined;
}
