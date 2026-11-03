/**
 * @author Codex
 * @description Defines bounded agent-owned questions and validates answers independently of their form presentation.
 */
import { z } from 'zod';

const identifier = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/)
  .refine((id) => !['constructor', 'prototype'].includes(id));
const base = {
  id: identifier,
  label: z.string().trim().min(1).max(120),
  required: z.boolean(),
};
const options = z
  .array(z.strictObject({ id: identifier, label: z.string().min(1).max(120) }))
  .min(2)
  .max(8)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length);
const field = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('single'), options }),
  z.strictObject({
    ...base,
    type: z.literal('multiple'),
    options,
    min: z.number().int().min(0).max(8),
    max: z.number().int().min(1).max(8),
  }),
  z.strictObject({ ...base, type: z.enum(['text', 'email']), maxLength: z.number().int().min(1).max(2000) }),
  z.strictObject({ ...base, type: z.literal('number'), min: z.number().finite(), max: z.number().finite() }),
  z.strictObject({ ...base, type: z.literal('date') }),
]);

export const skillQuestionSchema = z
  .strictObject({
    question: z.string().trim().min(1).max(300),
    reason: z.string().max(400).optional(),
    fields: z.array(field).min(1).max(4),
    // Omitting this UI policy must not reject an otherwise valid business question.
    allowDefer: z.boolean().default(false),
    choiceDecision: z
      .discriminatedUnion('operation', [
        z.strictObject({
          requirementId: z.string().regex(/^choice-action-[1-9]\d{0,4}$/),
          operation: z.literal('omit'),
        }),
        z.strictObject({
          requirementId: z.string().regex(/^choice-action-[1-9]\d{0,4}$/),
          operation: z.literal('set'),
          state: z.union([z.boolean(), z.array(z.string().min(1).max(160)).max(20)]),
        }),
      ])
      .optional(),
  })
  .superRefine((question, context) => {
    if (new Set(question.fields.map((item) => item.id)).size !== question.fields.length) {
      context.addIssue({ code: 'custom', path: ['fields'], message: 'Duplicate field id' });
    }
    question.fields.forEach((item, index) => {
      if ((item.type === 'number' || item.type === 'multiple') && item.min > item.max) {
        context.addIssue({ code: 'custom', path: ['fields', index], message: 'Invalid range' });
      }
      if (item.type === 'multiple' && (item.min > item.options.length || item.max > item.options.length)) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index],
          message: 'Choice range exceeds options',
        });
      }
    });
  });
export type SkillQuestion = z.infer<typeof skillQuestionSchema>;
export type SkillFieldExplanation = { kind: 'explanation'; text: string };
export type SkillAnswerValue = string | number | string[] | SkillFieldExplanation;
export type SkillAnswer =
  { status: 'answered'; values: Record<string, SkillAnswerValue> } | { status: 'deferred' };
/**
 * Distinguishes a user correction from a literal parameter or model-defined choice ID.
 */
export function isFieldExplanation(value: unknown): value is SkillFieldExplanation {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'kind' in value &&
    value.kind === 'explanation'
  );
}
const answerSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('answered'),
    values: z.record(
      identifier,
      z.union([
        z.string().max(2000),
        z.number().finite(),
        z.array(identifier).max(8),
        z.strictObject({ kind: z.literal('explanation'), text: z.string().trim().min(1).max(2000) }),
      ])
    ),
  }),
  z.strictObject({ status: z.literal('deferred') }),
]);

/**
 * Rejects undeclared, missing or mistyped values; identifiers remain text and never lose leading zeros.
 */
export function validateSkillAnswer(question: SkillQuestion, raw: unknown): SkillAnswer {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success || new TextEncoder().encode(JSON.stringify(parsed.data)).length > 8192) {
    throw new Error('SKILL_ANSWER_INVALID');
  }
  const answer = parsed.data;
  if (answer.status === 'deferred') {
    if (!question.allowDefer) {
      throw new Error('SKILL_ANSWER_REQUIRED');
    }
    return answer;
  }
  const names = new Set(question.fields.map((item) => item.id));
  if (Object.keys(answer.values).some((name) => !names.has(name))) {
    throw new Error('SKILL_ANSWER_INVALID');
  }
  for (const item of question.fields) {
    const value = answer.values[item.id];
    if (isFieldExplanation(value)) {
      continue;
    }
    const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (item.required) {
        throw new Error('SKILL_ANSWER_REQUIRED');
      }
      delete answer.values[item.id];
      continue;
    }
    let valid: boolean;
    if (item.type === 'single') {
      valid = typeof value === 'string' && item.options.some((option) => option.id === value);
    } else if (item.type === 'multiple') {
      valid =
        Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.length >= item.min &&
        value.length <= item.max &&
        value.every((id) => item.options.some((option) => option.id === id));
    } else if (item.type === 'number') {
      valid = typeof value === 'number' && value >= item.min && value <= item.max;
    } else if (item.type === 'date') {
      valid =
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value;
    } else {
      valid = typeof value === 'string' && value.trim().length > 0 && value.length <= item.maxLength;
      if (item.type === 'email') {
        valid = valid && z.email().safeParse(value).success;
      }
    }
    if (!valid) {
      throw new Error('SKILL_ANSWER_INVALID');
    }
  }
  return answer;
}
