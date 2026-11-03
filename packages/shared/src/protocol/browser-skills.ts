/**
 * @author Codex
 * @description Defines bounded browser-skill packages and installation-scoped Native file operations without arbitrary paths.
 */
import { z } from 'zod';
import { parseDocument } from 'yaml';

/**
 * Stable value-free explanations are shared by Native validation and agent repair feedback.
 */
export const browserSkillIssueMessages = {
  SKILL_METADATA_MISSING:
    'SKILL.md 必须以 --- 分隔的 YAML 元信息开头，包含 name 和 description；不要删除元信息。',
  SKILL_METADATA_YAML:
    '元信息必须是有效 YAML 映射，不允许重复字段、自定义标签或别名；含特殊符号的字符串请加引号。',
  SKILL_METADATA_NAME: 'name 必须是非空单行文本，最多120字符；支持中文、英文、空格和标点，不要求英文短名称。',
  SKILL_METADATA_DESCRIPTION: 'description 必须是非空文本，最多2000字符；支持中文、引号和 YAML 多行文本。',
  SKILL_UNDECLARED_INPUT: '正文中的 {{参数名}} 必须对应 workflow.inputs 中声明的 name；补齐声明或纠正引用。',
  SKILL_BYTE_LIMIT: 'SKILL.md 的 UTF-8 内容不得超过64KiB，workflow.json不得超过32KiB。',
  SKILL_DUPLICATE_INPUT: 'workflow.inputs 中的 name 不得重复。',
  SKILL_DUPLICATE_PAGE: 'workflow.pages 中的 role 不得重复。',
  SKILL_DUPLICATE_ORIGIN: 'workflow.allowedOrigins 不得重复。',
  SKILL_PAGE_OUTSIDE_ORIGINS: '页面 startUrl 的 origin 必须列在 workflow.allowedOrigins 中。',
  SKILL_RESERVED_IDENTIFIER: '参数或页面标识不能使用 constructor、prototype、__proto__。',
  SKILL_WEB_URL: '地址只允许不含用户名和密码的 HTTP/HTTPS URL。',
  SKILL_ORIGIN_FORMAT: 'allowedOrigins 只填写协议、主机与可选端口，不带末尾斜杠、路径、查询或片段。',
} as const;

const markdownDescription =
  'SKILL.md Markdown，必须以 YAML frontmatter 开头：---\nname: 中文技能名称\ndescription: 技能用途说明\n---\n正文。name支持中文/英文/空格/标点，是显示名称而不是目录名，非空单行、最多120字符；description非空、最多2000字符，支持引号或多行文本。正文 {{inputName}} 必须在 workflow.inputs.name 声明。';

/**
 * Parses bounded metadata as YAML rather than treating a display name as a filesystem slug.
 * Returns only a stable diagnostic code, never parser errors containing document values.
 */
function metadataIssue(markdown: string): keyof typeof browserSkillIssueMessages | undefined {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match || match[1] === undefined) {
    return 'SKILL_METADATA_MISSING';
  }
  let metadata: unknown;
  try {
    const document = parseDocument(match[1], { schema: 'core', uniqueKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) {
      return 'SKILL_METADATA_YAML';
    }
    metadata = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
  } catch {
    return 'SKILL_METADATA_YAML';
  }
  if (!(metadata instanceof Map)) {
    return 'SKILL_METADATA_YAML';
  }
  const name: unknown = metadata.get('name');
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 120 ||
    [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    return 'SKILL_METADATA_NAME';
  }
  const description: unknown = metadata.get('description');
  if (typeof description !== 'string' || !description.trim() || description.length > 2000) {
    return 'SKILL_METADATA_DESCRIPTION';
  }
  return undefined;
}

const fieldId = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/)
  .refine((id) => !['constructor', 'prototype', '__proto__'].includes(id), {
    message: 'SKILL_RESERVED_IDENTIFIER',
  });
const webUrl = z
  .url()
  .max(2048)
  .refine(
    (value) => {
      if (!URL.canParse(value)) {
        return false;
      }
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    },
    { message: 'SKILL_WEB_URL' }
  );
const origin = webUrl.refine((value) => URL.canParse(value) && new URL(value).origin === value, {
  message: 'SKILL_ORIGIN_FORMAT',
});
export const browserChoiceStateSchema = z.union([
  z.boolean(),
  z.array(z.string().min(1).max(160)).max(20),
  z.null(),
]);
export const browserChoiceControlSchema = z
  .strictObject({
    role: z.enum(['radio', 'checkbox', 'switch', 'select']),
    group: z.string().max(160),
    label: z.string().min(1).max(160),
    state: browserChoiceStateSchema,
  })
  .superRefine((choice, context) => {
    if (choice.state !== null && (choice.role === 'select') !== Array.isArray(choice.state)) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Choice state must match the control role',
      });
    }
  });
export type BrowserChoiceControl = z.infer<typeof browserChoiceControlSchema>;
export const browserSkillChoiceSchema = z.strictObject({
  id: z.string().regex(/^choice-action-[1-9]\d{0,4}$/),
  ref: z.string().regex(/^action-[1-9]\d{0,4}$/),
  url: webUrl,
  control: browserChoiceControlSchema,
});
export type BrowserSkillChoice = z.infer<typeof browserSkillChoiceSchema>;

export const browserSkillWorkflowSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    inputs: z
      .array(
        z.strictObject({
          name: fieldId,
          label: z.string().min(1).max(120),
          type: z.enum(['text', 'email', 'number', 'date']),
          required: z.boolean(),
          sourceRef: z
            .string()
            .regex(/^action-[1-9]\d{0,4}$/)
            .optional(),
        })
      )
      .max(20),
    allowedOrigins: z.array(origin).min(1).max(16),
    pages: z
      .array(z.strictObject({ role: fieldId, startUrl: webUrl }))
      .min(1)
      .max(16),
    execution: z.strictObject({ maxModelCalls: z.number().int().min(1).max(20) }),
    choices: z
      .array(browserSkillChoiceSchema)
      .max(100)
      .optional()
      .describe('由录制事实和已确认的选择决策生成；不能省略或擅自改变选择。只供重放读取，不是步骤DAG。'),
    evidence: z
      .array(
        z.strictObject({
          ref: z.string().regex(/^action-[1-9]\d{0,4}$/),
          kind: z.string().min(1).max(30),
          targetHint: z.string().max(160),
        })
      )
      .max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.choices?.map((choice) => choice.id)).size !== (value.choices?.length ?? 0)) {
      context.addIssue({ code: 'custom', path: ['choices'], message: 'Duplicate choice id' });
    }
    value.choices?.forEach((choice, index) => {
      if (URL.canParse(choice.url) && !value.allowedOrigins.includes(new URL(choice.url).origin)) {
        context.addIssue({
          code: 'custom',
          path: ['choices', index, 'url'],
          message: 'Choice origin is outside skill scope',
        });
      }
    });
    if (new Set(value.inputs.map((item) => item.name)).size !== value.inputs.length) {
      context.addIssue({ code: 'custom', path: ['inputs'], message: 'SKILL_DUPLICATE_INPUT' });
    }
    if (new Set(value.pages.map((item) => item.role)).size !== value.pages.length) {
      context.addIssue({ code: 'custom', path: ['pages'], message: 'SKILL_DUPLICATE_PAGE' });
    }
    if (new Set(value.allowedOrigins).size !== value.allowedOrigins.length) {
      context.addIssue({ code: 'custom', path: ['allowedOrigins'], message: 'SKILL_DUPLICATE_ORIGIN' });
    }
    value.pages.forEach((page, index) => {
      if (URL.canParse(page.startUrl) && !value.allowedOrigins.includes(new URL(page.startUrl).origin)) {
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'startUrl'],
          message: 'SKILL_PAGE_OUTSIDE_ORIGINS',
        });
      }
    });
  });
export const browserSkillPackageSchema = z
  .strictObject({
    skillMarkdown: z.string().trim().min(1).max(30000).describe(markdownDescription),
    workflow: browserSkillWorkflowSchema,
  })
  .superRefine((value, context) => {
    if (
      new TextEncoder().encode(value.skillMarkdown).length > 65536 ||
      new TextEncoder().encode(JSON.stringify(value.workflow)).length > 32768
    ) {
      context.addIssue({ code: 'custom', message: 'SKILL_BYTE_LIMIT' });
    }
    const metadataError = metadataIssue(value.skillMarkdown);
    if (metadataError) {
      context.addIssue({ code: 'custom', path: ['skillMarkdown'], message: metadataError });
    }
    for (const match of value.skillMarkdown.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)) {
      if (!value.workflow.inputs.some((input) => input.name === match[1])) {
        context.addIssue({ code: 'custom', path: ['skillMarkdown'], message: 'SKILL_UNDECLARED_INPUT' });
      }
    }
  });
export type BrowserSkillPackage = z.infer<typeof browserSkillPackageSchema>;

const requestBase = { requestId: z.uuid(), connectionId: z.uuid() };
export const browserSkillRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...requestBase,
    type: z.literal('skills.create'),
    operationId: z.uuid(),
    candidate: browserSkillPackageSchema,
  }),
  z.strictObject({ ...requestBase, type: z.literal('skills.read'), skillId: z.uuid() }),
  z.strictObject({ ...requestBase, type: z.literal('skills.delete'), skillId: z.uuid() }),
  z.strictObject({ ...requestBase, type: z.literal('skills.receipt'), operationId: z.uuid() }),
  z.strictObject({ ...requestBase, type: z.literal('skills.open-directory'), skillId: z.uuid() }),
]);
export const browserSkillReceiptSchema = z.strictObject({
  skillId: z.uuid(),
  operationId: z.uuid(),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const browserSkillSnapshotSchema = z.strictObject({
  skillId: z.uuid(),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  candidate: browserSkillPackageSchema,
});
export const browserSkillResponseSchema = z
  .strictObject({
    type: z.literal('skills.result'),
    ...requestBase,
    value: z
      .union([
        browserSkillReceiptSchema,
        browserSkillSnapshotSchema,
        z.strictObject({ opened: z.literal(true) }),
        z.strictObject({ deleted: z.literal(true) }),
        z.null(),
      ])
      .optional(),
    error: z
      .enum([
        'SKILL_INVALID',
        'SKILL_MISSING',
        'SKILL_PATH',
        'SKILL_CHANGED',
        'SKILL_CONFLICT',
        'SKILL_STORAGE',
        'SKILL_OFFLINE',
        'SKILL_OPEN_FAILED',
      ])
      .optional(),
  })
  .refine((value) => (value.error !== undefined) !== Object.hasOwn(value, 'value'));
export type BrowserSkillRequest = z.infer<typeof browserSkillRequestSchema>;
export type BrowserSkillResponse = z.infer<typeof browserSkillResponseSchema>;
export type BrowserSkillReceipt = z.infer<typeof browserSkillReceiptSchema>;
export type BrowserSkillSnapshot = z.infer<typeof browserSkillSnapshotSchema>;
