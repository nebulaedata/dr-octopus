/**
 * @author Codex
 * @description Bilingual public message catalog for session-domain error codes.
 * Codes with a single thrown message keep it as the generic variant verbatim; mixed-language
 * codes add site variants for their Chinese sites while English sites fall back to the generic.
 */

import { registerErrorMessages } from '../../lib/i18n/error-catalog.js';
import type { ErrorMessageCatalog } from '../../lib/i18n/error-catalog.js';

/**
 * Session-domain message variants keyed by stable error code.
 */
export const sessionErrorMessages: ErrorMessageCatalog = {
  CONVERSATION_DELIVERY_UNKNOWN: {
    en: 'Delivery could not be confirmed. Inspect the conversation before sending again.',
    'zh-CN': '无法确认消息是否送达，请检查会话后再决定是否重新发送。',
  },
  CONVERSATION_PREPARATION_FAILED: {
    en: 'Conversation preparation did not complete. Check the model and selected work-mode settings, then retry your saved draft.',
    'zh-CN': '会话准备未完成，请检查模型和所选工作模式的配置后重试，草稿内容已保留。',
  },
  CONVERSATION_START_CONFLICT: {
    en: 'This submission conflicts with another saved request. Check its status before retrying.',
    'zh-CN': '提交与已保存的请求冲突，请先检查提交状态。',
  },
  CONVERSATION_MODEL_REQUIRED: {
    en: 'Choose an available model before sending.',
    'zh-CN': '请先配置并选择可用模型。',
  },
  CONVERSATION_START_CLOSED: {
    en: 'Conversation preparation is unavailable.',
    'zh-CN': '暂时无法准备会话。',
  },
  CONVERSATION_START_NOT_FOUND: {
    en: 'Conversation submission was not found.',
    'zh-CN': '未找到会话提交记录。',
  },
  CONVERSATION_START_INVALID: { en: 'Invalid conversation submission.', 'zh-CN': '会话提交内容无效。' },
  INVALID_RESTART_REQUEST: {
    en: 'The session restart request is invalid.',
    'zh-CN': '无效的会话重启请求。',
  },
  SESSION_CONFIGURATION_STALE: {
    en: 'Configuration changed. Apply the update before sending another message.',
    'zh-CN': '配置已变化，请应用更新后再发送新消息。',
  },
  SESSION_BUSY: {
    en: 'A task or interaction is still running; restarting will interrupt it.',
    'zh-CN': '当前任务或交互尚未结束，重启将中断任务。',
  },
  SESSION_NOT_FOUND: [
    { en: 'The session no longer exists.', 'zh-CN': '会话不存在或已删除。' },
    { match: '会话已删除。', en: 'The session was deleted.', 'zh-CN': '会话已删除。' },
  ],
  SESSION_RESTART_FAILED: [
    { en: 'The session restart failed; try again.', 'zh-CN': '会话重启失败，请重试。' },
    {
      match: '无法确认旧进程退出，会话已停止接受新任务。',
      en: 'The old process could not be confirmed stopped; the session no longer accepts new tasks.',
      'zh-CN': '无法确认旧进程退出，会话已停止接受新任务。',
    },
  ],
  SESSION_RESTART_IN_PROGRESS: {
    en: 'The session is restarting or stopping; try again later.',
    'zh-CN': '会话正在重启或停止，请稍后重试。',
  },
  SESSION_RESTART_UNSUPPORTED: {
    en: 'This session does not support restart.',
    'zh-CN': '此会话不支持重启。',
  },
  SESSION_RUNTIME_BINDING_MISMATCH: [
    { en: 'The runtime target is stale; refresh and try again.', 'zh-CN': '运行目标已过期，请刷新后重试。' },
    {
      match: '会话进程已变化，请刷新后重试。',
      en: 'The session process changed; refresh and try again.',
      'zh-CN': '会话进程已变化，请刷新后重试。',
    },
  ],
};

/**
 * Merges the session-domain catalog into the shared error-message registry at Server boot.
 */
export function registerSessionErrorMessages(): void {
  registerErrorMessages('sessions', sessionErrorMessages);
}
