/**
 * @author Codex
 * @description Defines authenticated Popup and Agent Host commands for bounded skill sessions, without a free-chat endpoint.
 */
import { z } from 'zod';
import { skillFinishReasonSchema } from './skill-response';
import { modelMessageSchema } from 'ai';

export const windowPanelRouteSchema = z.strictObject({
  recordingId: z.uuid(),
  mode: z.enum(['organize', 'replay']),
  sessionId: z.uuid().optional(),
});
export type WindowPanelRoute = z.infer<typeof windowPanelRouteSchema>;
const identity = { id: z.uuid(), epoch: z.uuid() };
const historyCursorSchema = z.strictObject({
  recordingId: z.uuid().optional(),
  mode: z.enum(['organize', 'replay']).optional(),
  updatedAt: z.number().finite(),
  id: z.uuid(),
});
export const skillCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('skill.panel.open'),
    windowId: z.number().int().nonnegative(),
    route: windowPanelRouteSchema,
  }),
  z.strictObject({ type: z.literal('skill.panel.view'), route: windowPanelRouteSchema.optional() }),
  z.strictObject({ type: z.literal('skill.recordings') }),
  z.strictObject({
    type: z.literal('skill.history'),
    recordingId: z.uuid().optional(),
    mode: z.enum(['organize', 'replay']).optional(),
    cursor: historyCursorSchema.optional(),
  }),
  z.strictObject({ type: z.literal('skill.state'), recordingId: z.uuid() }),
  z.strictObject({ type: z.literal('skill.get'), id: z.uuid() }),
  z.strictObject({
    type: z.literal('skill.delete'),
    ...identity,
    revision: z.number().int().nonnegative(),
    deleteSkill: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('skill.start'),
    recordingId: z.uuid(),
    mode: z.enum(['organize', 'replay']),
    browserCopy: z
      .strictObject({ skillId: z.uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })
      .optional(),
    consent: z.strictObject({ baseUrl: z.string().max(1024), model: z.string().max(160) }).optional(),
  }),
  z.strictObject({
    type: z.literal('skill.answer'),
    ...identity,
    revision: z.number().int().nonnegative(),
    submissionId: z.uuid(),
    toolCallId: z.string().min(1).max(128),
    answer: z.json(),
  }),
  z.strictObject({ type: z.literal('skill.continue'), ...identity }),
  z.strictObject({
    type: z.literal('skill.extend-budget'),
    ...identity,
    revision: z.number().int().nonnegative(),
    additional: z.number().int().min(1).max(100),
  }),
  z.strictObject({ type: z.literal('skill.cancel'), ...identity }),
  z.strictObject({ type: z.literal('skill.resolve-unknown'), ...identity, confirmed: z.literal(true) }),
  z.strictObject({ type: z.literal('skill.open-directory'), recordingId: z.uuid() }),
  z.strictObject({ type: z.literal('skill.export'), recordingId: z.uuid(), skillId: z.uuid() }),
  z.strictObject({ type: z.literal('skill.save-to-executor'), recordingId: z.uuid(), skillId: z.uuid() }),
  z.strictObject({ type: z.literal('skill.retry-save'), ...identity }),
  z.strictObject({ type: z.literal('skill.host.ready'), ...identity }),
  z.strictObject({ type: z.literal('skill.host.prepare'), ...identity }),
  z.strictObject({ type: z.literal('skill.host.end'), ...identity }),
  z.strictObject({
    type: z.literal('skill.host.checkpoint'),
    ...identity,
    messages: z
      .array(modelMessageSchema)
      .max(40)
      .refine((items) => items.every((message) => message.role === 'assistant' || message.role === 'tool')),
  }),
  z.strictObject({ type: z.literal('skill.host.tool'), ...identity, toolCallId: z.string().min(1).max(128) }),
  z.strictObject({
    type: z.literal('skill.host.step'),
    ...identity,
    finishReason: skillFinishReasonSchema,
    messages: z
      .array(modelMessageSchema)
      .max(20)
      .refine((items) => items.every((message) => message.role === 'assistant')),
    calls: z
      .array(
        z.strictObject({
          toolCallId: z.string().min(1).max(128),
          toolName: z.string().min(1).max(100),
          input: z.json(),
          invalid: z.boolean().optional(),
          inputIssues: z
            .array(
              z.strictObject({
                code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
                path: z.array(z.union([z.string().max(40), z.number().int().nonnegative()])).max(12),
              })
            )
            .max(20)
            .optional(),
        })
      )
      .max(20),
  }),
  z.strictObject({
    type: z.literal('skill.host.failed'),
    ...identity,
    error: z.string().regex(/^[A-Z_]{1,80}$/),
  }),
]);
export type SkillCommand = z.infer<typeof skillCommandSchema>;
export type SkillHistoryItem = {
  id: string;
  recordingId: string;
  mode: 'organize' | 'replay';
  updatedAt: number;
  windowId?: number;
  name: string;
  createdAt: number;
  status: import('./skill-session').SkillSession['status'];
  model?: string;
  retryOf?: string;
};
export type SkillHistoryPage = {
  items: SkillHistoryItem[];
  active: SkillHistoryItem[];
  cursor?: z.infer<typeof historyCursorSchema>;
  total: number;
};
export type RecordingSkillState = {
  recordingId: string;
  status: 'organizing' | 'organized' | 'waiting_user' | 'saving';
  skillId?: string;
};

/**
 * Projects bounded domain failures to concise UI copy without exposing provider bodies or local filesystem paths.
 */
export function skillError(code: string): string {
  const messages: Record<string, string> = {
    SKILL_SETTINGS_REQUIRED: '请先配置模型。',
    SKILL_CONSENT_REQUIRED: '请确认向当前模型发送本次任务所需数据。',
    SKILL_OFFLINE: 'Executor 未连接；浏览器中的技能仍可使用和导出。',
    SKILL_NO_BROWSER_COPY: '浏览器副本不可用；有本地目录时请连接 Executor 读取，否则请重新整理。',
    SKILL_CACHED_COPY_CONFIRMATION_REQUIRED: '无法读取本地技能文件，请确认是否使用浏览器副本。',
    SKILL_EXECUTOR_NOT_SAVED: '技能保存在浏览器中，尚未保存到本地目录。',
    SKILL_SCOPE_CHANGED: '技能范围超出本录制已授权的站点。',
    SKILL_MISSING: '尚无可用技能，请先整理。',
    SKILL_INVALID: '技能内容未通过校验。',
    SKILL_RECORDING_SEMANTICS_REQUIRED: '这份录制缺少控件类型，无法可靠区分填写与选择，请重新录制。',
    SKILL_CHOICE_UNRESOLVED: '录制选择尚未确认或当前页面无法满足，请查看具体结果并回答问题。',
    SKILL_CHOICE_DECISION_INVALID: '选择确认没有对应当前录制要求，请重新提问。',
    SKILL_ANSWER_INVALID: '请检查填写内容。',
    SKILL_ANSWER_REQUIRED: '请填写必填内容。',
    SKILL_SESSION_STALE: '任务已更新，请刷新后重试。',
    SKILL_PANEL_OWNER: '任务正在另一个窗口执行，请回到原窗口。',
    SKILL_PANEL_REQUIRED: '请在侧边栏中执行此操作。',
    SKILL_DELETE_BLOCKED: '请先停止执行或核实未知结果，再删除会话。',
    SKILL_IN_USE: '其他未结束的重放会话正在使用此技能，请先停止重放或核实执行结果。',
    SKILL_DELETE_FILES_FAILED:
      '本地技能文件未确认删除，会话和浏览器副本已保留。请连接 Executor 后重试；目录中有额外文件或链接时，请先自行处理。',
    SKILL_BUSY: '已有任务正在执行。',
    SKILL_BUDGET_LIMIT: '单次任务最多500轮，无法再追加，请检查任务过程。',
    SKILL_MODEL_BUDGET: '已达到本次模型调用上限。',
    SKILL_TOOL_BUDGET: '已达到本次工具调用上限。',
    SKILL_HOST_CLOSED: '执行已中断，可查看历史后继续。',
    SKILL_FILE_OUTCOME_UNKNOWN: '保存结果尚未确认，请查询后重试保存。',
    SKILL_CHANGED: '技能文件正在变化，请稍后重试。',
    SKILL_OPEN_FAILED: '文件夹未能打开。',
    SKILL_STORAGE: '任务未能保存，请重试。',
    SKILL_TOOL_INPUT_INVALID: '工具参数未通过校验，智能体需要修正。',
    SKILL_CONFLICT: '保存内容与已有副本冲突。',
    SKILL_PATH: '技能目录不可用。',
    MODEL_UNAVAILABLE: '模型服务不可用，请稍后重试。',
    MODEL_EMPTY_RESPONSE: '模型未返回可用内容，本次回复信息已记录。',
    MODEL_OUTPUT_TRUNCATED: '模型回复达到输出长度上限，未执行该轮操作。',
    MODEL_RESPONSE_FILTERED: '模型回复被内容过滤，未执行该轮操作。',
    MODEL_RESPONSE_ERROR: '模型报告响应错误，未执行该轮操作。',
    MODEL_FINISH_UNKNOWN: '模型返回了无法识别的结束原因，未执行该轮操作。',
    SKILL_RESPONSE_RECOVERY_EXHAUSTED: '模型回复未能完成工具协议，已达到本次自动纠正上限。',
    SKILL_RECOVERY_ACTION_BLOCKED: '纠正阶段不重复执行页面操作，请通过提问确认后继续。',
    SKILL_NO_TOOL: '模型未返回可执行的工具请求。',
    SKILL_NO_PROGRESS: '同一工具连续修正三次仍未通过，已停止；请查看工具结果后再继续。',
    SKILL_OBSERVATION_REQUIRED: '请先观察允许访问的目标页面，再使用新的页面结果操作或确认完成。',
    SKILL_ACCESS_RECOVERY_REQUIRED: '请先恢复页面访问；权限缺失时只能询问用户或报告未完成，不能继续页面操作。',
    BROWSER_BUSY: '浏览器正在执行其他任务，请稍后继续。',
    FORBIDDEN_PAGE: '当前页面不在本次允许范围。',
    PAGE_READY_TIMEOUT: '页面连续等待超时，已停止本次任务。已保留打开的标签页，请核对页面或调整等待设置后重试。',
    FRAME_SCOPE_LIMIT: '页面的可访问子页面层级过深，无法安全建立快照；这不是站点权限不足。',
    OUTCOME_UNKNOWN: '上次操作结果尚未确认，已停止后续操作。',
    SKILL_OUTCOME_UNKNOWN: '上次操作结果尚未确认，已停止后续操作。',
  };
  return messages[code] ?? '任务未完成，请查看过程后重试。';
}
