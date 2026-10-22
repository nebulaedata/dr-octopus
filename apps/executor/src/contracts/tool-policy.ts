/**
 * @author Codex
 * @description Defines bounded tool policy settings and credential-free desktop projections.
 */
import { z } from 'zod';

export const policyToolNameSchema = z.enum([
  'read',
  'write',
  'edit',
  'powershell',
  'grep',
  'find',
  'ls',
  'runtime_status',
  'task_start',
  'task_status',
  'task_end',
  'task_stop',
  'file_upload_prepare',
  'file_download_prepare',
  'file_transfer_status',
  'file_transfer_cancel',
  'browser_list',
  'browser_tabs',
  'browser_open_tab',
  'browser_navigate',
  'browser_close_tab',
  'browser_snapshot',
  'browser_read_snapshot',
  'browser_click',
  'browser_fill',
  'browser_select',
  'browser_scroll',
  'computer.screenshot',
  'computer.snapshot',
  'computer.click',
  'computer.type',
  'computer.scroll',
  'computer.shortcut',
  'computer.app.switch',
  'computer.display.list',
  'computer.control.status',
]);
export const enabledToolsSchema = z
  .array(policyToolNameSchema)
  .max(100)
  .refine((names) => new Set(names).size === names.length, '工具不能重复');
export const runtimeToolPolicySchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  enabledTools: enabledToolsSchema,
});
export const customToolPolicySchema = z.strictObject({
  id: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^\p{Cc}]+$/u, '名称不能包含控制字符'),
  enabledTools: enabledToolsSchema,
});
export const toolPolicySettingsSchema = z
  .strictObject({
    revision: z.number().int().nonnegative(),
    selectedId: z.union([z.enum(['readonly', 'all']), z.uuid()]),
    custom: z.array(customToolPolicySchema).max(50),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.custom.map((policy) => policy.id)).size !== value.custom.length ||
      new Set(value.custom.map((policy) => policy.name.toLocaleLowerCase())).size !== value.custom.length ||
      value.custom.some((policy) => ['只读', '全部'].includes(policy.name))
    ) {
      context.addIssue({ code: 'custom', message: '策略名称和标识不能重复或使用系统名称' });
    }
    if (
      !['readonly', 'all'].includes(value.selectedId) &&
      !value.custom.some((policy) => policy.id === value.selectedId)
    ) {
      context.addIssue({ code: 'custom', message: '选中的策略不存在' });
    }
  });
export const defaultToolPolicySettings = toolPolicySettingsSchema.parse({
  revision: 0,
  selectedId: 'readonly',
  custom: [],
});
export const policyToolSchema = z.strictObject({
  name: policyToolNameSchema,
  label: z.string().max(100),
  description: z.string().max(300),
  group: z.enum(['basic', 'control', 'transfer', 'browser', 'computer']),
  readOnly: z.boolean(),
});
export const toolPoliciesResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    data: z.strictObject({
      settings: toolPolicySettingsSchema,
      tools: z.array(policyToolSchema).max(100),
      applied: z.boolean(),
    }),
  }),
  z.strictObject({ ok: z.literal(false), message: z.string().max(200) }),
]);
export type PolicyToolName = z.infer<typeof policyToolNameSchema>;
export type PolicyTool = z.infer<typeof policyToolSchema>;
export type ToolPolicySettings = z.infer<typeof toolPolicySettingsSchema>;
export type CustomToolPolicy = z.infer<typeof customToolPolicySchema>;
export type ToolPoliciesResponse = z.infer<typeof toolPoliciesResponseSchema>;
