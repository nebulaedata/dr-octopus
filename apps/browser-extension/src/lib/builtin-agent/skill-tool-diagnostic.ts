/**
 * @author Codex
 * @description Projects authoritative tool failures and bounded schema paths without exposing SDK error text or business values.
 */
import type { SkillSession } from './skill-session';
import { pageAccessSchema } from '../../page-access';

export type SkillToolIssue = { code: string; path: (string | number)[] };
export const toolIssuePathKeys = [
  'workflow',
  'skillMarkdown',
  'schemaVersion',
  'inputs',
  'id',
  'label',
  'type',
  'required',
  'default',
  'options',
  'min',
  'max',
  'allowedOrigins',
  'pages',
  'role',
  'startUrl',
  'execution',
  'maxModelCalls',
  'evidence',
  'ref',
  'note',
  'question',
  'reason',
  'fields',
  'allowDefer',
  'maxLength',
  'choices',
  'control',
  'group',
  'state',
  'sourceRef',
  'choiceDecision',
  'requirementId',
  'operation',
] as const;

/**
 * Keeps only finite codes and known schema property names; never exports an SDK cause or received value.
 */
export function safeToolIssues(raw: unknown): SkillToolIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.slice(0, 20).map((issue) => ({
    code:
      issue && typeof issue.code === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{1,79}$/.test(issue.code)
        ? issue.code.toUpperCase()
        : 'SKILL_TOOL_INPUT_INVALID',
    path: Array.isArray(issue?.path)
      ? issue.path
          .slice(0, 12)
          .map((part: unknown) =>
            typeof part === 'number' && Number.isSafeInteger(part) && part >= 0
              ? part
              : typeof part === 'string' && toolIssuePathKeys.some((key) => key === part)
                ? part
                : '[field]'
          )
      : [],
  }));
}

/**
 * Walks only the bounded SDK validation cause chain, without parsing or retaining error messages.
 */
export function toolInputIssues(error: unknown): SkillToolIssue[] {
  for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth++) {
    if ('issues' in error && Array.isArray(error.issues)) {
      return safeToolIssues(error.issues);
    }
    error = 'cause' in error ? error.cause : undefined;
  }
  return [];
}

/**
 * Uses the durable ledger before SDK presentation text; only a later admitted question proves this input error corrected.
 */
export function skillToolDiagnostic(
  session: SkillSession,
  toolCallId: string,
  toolName: string,
  fallback: string,
  messageIndex: number
) {
  const stored = session.ledger?.[toolCallId];
  const entry = stored?.toolName === toolName ? stored : undefined;
  const output = entry?.result?.output;
  const authoritative =
    output?.type === 'error-text'
      ? output.value
      : output?.type === 'json' &&
          output.value &&
          typeof output.value === 'object' &&
          !Array.isArray(output.value) &&
          'error' in output.value &&
          typeof output.value.error === 'string'
        ? output.value.error
        : undefined;
  const code =
    [authoritative, fallback].find(
      (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value)
    ) ?? 'UNCLASSIFIED_ERROR';
  const recovered =
    toolName === 'ask_user_question' &&
    code === 'SKILL_TOOL_INPUT_INVALID' &&
    session.messages.slice(messageIndex + 1).some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => {
          if (part.type !== 'tool-call' || part.toolName !== toolName || part.toolCallId === toolCallId) {
            return false;
          }
          const later = session.ledger?.[part.toolCallId];
          return (
            later?.toolName === toolName &&
            !later.invalid &&
            ((session.status === 'waiting_user' &&
              session.pendingQuestion?.toolCallId === part.toolCallId &&
              later.state === 'pending') ||
              (later.state === 'completed' &&
                later.result?.output.type === 'json' &&
                later.result.output.value &&
                typeof later.result.output.value === 'object' &&
                'status' in later.result.output.value &&
                later.result.output.value.status === 'answered'))
          );
        })
    );
  const access =
    output?.type === 'json' && output.value && typeof output.value === 'object' && 'access' in output.value
      ? pageAccessSchema.safeParse(output.value.access)
      : undefined;
  return {
    code,
    recovered: Boolean(recovered),
    issues: safeToolIssues(entry?.inputIssues),
    ...(access?.success ? { access: access.data } : {}),
  };
}
