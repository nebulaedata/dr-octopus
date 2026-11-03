/**
 * @author Codex
 * @description Validates candidate structure and recording boundaries with value-free field diagnostics for bounded agent repair.
 */
import {
  browserSkillPackageSchema,
  browserSkillIssueMessages,
  type BrowserSkillPackage,
} from '@octopus/shared/protocol/browser-skills';
import type { RecordingEvidence } from '../recording/recording-evidence';
import {
  recordingChoices,
  hasConflictingChoicePhases,
  type ChoiceDecisions,
} from '../recording/recording-choices';

export type SkillIssue = { code: string; path: (string | number)[]; message?: string };
export type SkillValidation =
  { valid: true; candidate: BrowserSkillPackage; issues: [] } | { valid: false; issues: SkillIssue[] };

/**
 * Returns bounded codes and paths, never copies invalid field values or raw provider responses into diagnostics.
 */
export function validateSkillCandidate(
  raw: unknown,
  evidence: RecordingEvidence | undefined,
  decisions: ChoiceDecisions = {}
): SkillValidation {
  const parsed = browserSkillPackageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.slice(0, 20).map((issue) => {
        const known = issue.code === 'custom' && Object.hasOwn(browserSkillIssueMessages, issue.message);
        const code = known ? issue.message : 'SKILL_SCHEMA_' + issue.code.toUpperCase();
        const message = known
          ? browserSkillIssueMessages[issue.message as keyof typeof browserSkillIssueMessages]
          : '字段类型、格式或数量不符合工具 Schema，请检查该路径；不要删除必需字段。';
        return {
          code,
          message,
          path: issue.path.filter(
            (part): part is string | number => typeof part === 'string' || typeof part === 'number'
          ),
        };
      }),
    };
  }
  if (!evidence) {
    return { valid: false, issues: [{ code: 'SKILL_EVIDENCE_MISSING', path: [] }] };
  }
  const issues: SkillIssue[] = [];
  if (hasConflictingChoicePhases(evidence)) {
    issues.push({
      code: 'SKILL_CHOICE_PHASES_UNSUPPORTED',
      path: ['workflow', 'choices'],
      message: '同一控件在不同操作阶段使用了不同选择，不能压缩为单一最终要求；请分段录制，避免丢失前序选择。',
    });
  }
  const choices = recordingChoices(evidence, decisions);
  const semanticRecording = evidence.events.some((event) => event.control || event.inputType);
  choices.forEach((choice, index) => {
    if (choice.control.state === null) {
      issues.push({
        code: 'SKILL_CHOICE_UNRESOLVED',
        path: ['workflow', 'choices', index],
        message: `选择结果未确认；使用 ask_user_question.choiceDecision 处理 ${choice.id}，不能猜测。`,
      });
    }
  });
  if (
    parsed.data.workflow.choices &&
    JSON.stringify(parsed.data.workflow.choices) !== JSON.stringify(choices)
  ) {
    issues.push({
      code: 'SKILL_CHOICE_CONFLICT',
      path: ['workflow', 'choices'],
      message: '选择要求由录制和用户已确认决策生成。不要改写；省略此字段由系统补齐，改变要求必须提问。',
    });
  }
  if (semanticRecording) {
    parsed.data.workflow.inputs.forEach((input, index) => {
      const source = evidence.actions.find((action) => action.id === input.sourceRef);
      if (!source || source.control || source.action !== 'fill') {
        issues.push({
          code: 'SKILL_INPUT_SOURCE_REQUIRED',
          path: ['workflow', 'inputs', index, 'sourceRef'],
          message: '参数必须引用实际可填写的录制动作；选择控件及说明文字不能作为文本/日期输入。',
        });
      } else if (source.inputType && ['number', 'email', 'date'].includes(source.inputType) && input.type !== source.inputType) {
        issues.push({ code: 'SKILL_INPUT_TYPE_CONFLICT', path: ['workflow', 'inputs', index, 'type'],
          message: '参数类型与实际录制控件的原生类型不一致，请参考sourceRef对应动作。' });
      }
    });
  }
  if (choices.length || semanticRecording) {
    parsed.data.workflow.choices = choices;
  }
  parsed.data.workflow.allowedOrigins.forEach((origin, index) => {
    if (!evidence.siteScopes.includes(origin)) {
      issues.push({ code: 'SKILL_SITE_OUTSIDE_RECORDING', path: ['workflow', 'allowedOrigins', index] });
    }
  });
  parsed.data.workflow.evidence.forEach((item, index) => {
    if (Number(item.ref.slice(7)) > evidence.actions.length) {
      issues.push({ code: 'SKILL_UNKNOWN_EVIDENCE', path: ['workflow', 'evidence', index, 'ref'] });
    }
  });
  if (issues.length) {
    return { valid: false, issues: issues.slice(0, 20) };
  }
  const canonical = browserSkillPackageSchema.safeParse(parsed.data);
  if (!canonical.success) {
    return {
      valid: false,
      issues: canonical.error.issues.slice(0, 20).map((issue) => ({
        code: 'SKILL_CANONICAL_' + issue.code.toUpperCase(),
        path: issue.path.filter(
          (part): part is string | number => typeof part === 'string' || typeof part === 'number'
        ),
        message: '包含录制选择后的技能包超限或范围不完整，请检查站点范围或缩小录制任务。',
      })),
    };
  }
  return { valid: true, candidate: canonical.data, issues: [] };
}
