/**
 * @author Codex
 * @description Global memory management using the same Agent SDK as TUI and RPC.
 * - GET /api/memory/export
 * - POST /api/memory/rebuild
 * - GET /api/memory/status
 * - GET /api/memory/indexes
 * - POST /api/memory/read
 * - POST /api/memory/remember
 * - POST /api/memory/forget
 * - POST /api/memory/policy
 * - GET /api/memory/service/status
 * - POST /api/memory/service/start
 * - POST /api/memory/service/stop
 * - POST /api/memory/service/restart
 */
import { Readable } from 'node:stream';
import { registerErrorMessages } from '../../infrastructure/i18n/error-catalog.js';
import type { MemoryForget, MemoryPolicy, MemoryRead, MemoryRemember } from '@octopus/shared/protocol/memory';
import type { FastifyInstance } from 'fastify';
import type { ErrorMessageCatalog } from '../../infrastructure/i18n/error-catalog.js';
import type { MemoryService } from './memory.service.js';

/**
 * Register within the existing Host API authority; no Workspace parameter grants additional access.
 */
export function registerMemoryController(server: FastifyInstance, service: MemoryService) {
  server.get('/memory/service/status', () => service.lifecycle('status'));
  for (const action of ['start', 'stop', 'restart'] as const) {
    server.post(`/memory/service/${action}`, () => service.lifecycle(action));
  }
  server.get('/memory/export', (_request, reply) =>
    reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="memory.md"')
      .send(Readable.from(service.exportWiki()))
  );
  server.post('/memory/rebuild', () => service.rebuildFts());
  server.get('/memory/status', () => service.status());
  server.get<{ Querystring: { query?: string; cursor?: string } }>('/memory/indexes', (request) =>
    service.indexes(
      request.query.query
        ? { mode: 'search', query: request.query.query }
        : { mode: 'page', cursor: request.query.cursor }
    )
  );
  server.post<{ Body: MemoryRead }>('/memory/read', (request) => service.read(request.body));
  server.post<{ Body: MemoryRemember }>('/memory/remember', (request) => service.remember(request.body));
  server.post<{ Body: MemoryForget }>('/memory/forget', (request) => service.forget(request.body));
  server.post<{ Body: MemoryPolicy }>('/memory/policy', (request) => service.policy(request.body));
}

/**
 * Memory-domain message variants keyed by stable error code.
 */
export const memoryErrorMessages: ErrorMessageCatalog = {
  BUDGET_EXHAUSTED: [
    { en: 'The memory budget for this turn is exhausted.', 'zh-CN': '本轮记忆预算已用尽。' },
    {
      match: '本轮记忆召回预算已用尽；本次未找到不表示从未讨论。',
      en: "This turn's memory recall budget is exhausted; no hit here does not mean the topic never came up.",
      'zh-CN': '本轮记忆召回预算已用尽；本次未找到不表示从未讨论。',
    },
    {
      match: '本轮记忆正文预算已用尽。',
      en: "This turn's memory content budget is exhausted.",
      'zh-CN': '本轮记忆正文预算已用尽。',
    },
  ],
  CANCELLED: [
    {
      match: '记忆整理已过期，请重新执行。',
      en: 'The memory organization expired; run it again.',
      'zh-CN': '记忆整理已过期，请重新执行。',
    },
    { match: '记忆操作已取消。', en: 'The memory operation was cancelled.', 'zh-CN': '记忆操作已取消。' },
    { match: '记忆策略已变化。', en: 'The memory policy changed.', 'zh-CN': '记忆策略已变化。' },
    {
      match: '记忆策略或删除屏障已经改变。',
      en: 'The memory policy or deletion barrier changed.',
      'zh-CN': '记忆策略或删除屏障已经改变。',
    },
    {
      match: '已忘记的资料不会自动恢复。',
      en: 'Forgotten material is not restored automatically.',
      'zh-CN': '已忘记的资料不会自动恢复。',
    },
  ],
  CURSOR_STALE: [
    { en: 'Memories changed; run the query again.', 'zh-CN': '记忆已变化，请重新查询。' },
    {
      match: '导出期间记忆已变化，请重新导出。',
      en: 'Memories changed during the export; export again.',
      'zh-CN': '导出期间记忆已变化，请重新导出。',
    },
    {
      match: '记忆已变化，请从首页重新查询。',
      en: 'Memories changed; query again from the first page.',
      'zh-CN': '记忆已变化，请从首页重新查询。',
    },
  ],
  INVALID_INPUT: [
    {
      match: '整理结果缺少有效用户来源。',
      en: 'The organization result lacks a valid user source.',
      'zh-CN': '整理结果缺少有效用户来源。',
    },
    { match: '记忆参数无效。', en: 'The memory parameters are invalid.', 'zh-CN': '记忆参数无效。' },
    {
      match: '记忆服务请求无效。',
      en: 'The memory service request is invalid.',
      'zh-CN': '记忆服务请求无效。',
    },
    { match: '未知记忆操作。', en: 'Unknown memory operation.', 'zh-CN': '未知记忆操作。' },
    {
      match: '整理结果格式无效。',
      en: 'The organization result format is invalid.',
      'zh-CN': '整理结果格式无效。',
    },
    {
      match: '整理结果不能修改未读取的事实。',
      en: 'The organization result cannot modify facts that were not read.',
      'zh-CN': '整理结果不能修改未读取的事实。',
    },
    {
      match: '记忆参数无效或超过长度限制。',
      en: 'The memory parameters are invalid or exceed the length limit.',
      'zh-CN': '记忆参数无效或超过长度限制。',
    },
    {
      match: '修订必须指定记忆与版本。',
      en: 'A revision must name the memory and its version.',
      'zh-CN': '修订必须指定记忆与版本。',
    },
    {
      match: '新建不能携带修订目标。',
      en: 'A new memory cannot carry a revision target.',
      'zh-CN': '新建不能携带修订目标。',
    },
    { match: '无效的记忆游标。', en: 'The memory cursor is invalid.', 'zh-CN': '无效的记忆游标。' },
    { match: '无效分页游标。', en: 'The pagination cursor is invalid.', 'zh-CN': '无效分页游标。' },
    { match: '无效正文游标。', en: 'The content cursor is invalid.', 'zh-CN': '无效正文游标。' },
    { match: '无效正文位置。', en: 'The content position is invalid.', 'zh-CN': '无效正文位置。' },
    { match: '正文游标越界。', en: 'The content cursor is out of range.', 'zh-CN': '正文游标越界。' },
  ],
  MEMORY_METADATA_INVALID: {
    en: 'The memory service control file is unreadable.',
    'zh-CN': '记忆服务控制文件不可读。',
  },
  MEMORY_RESPONSE_INVALID: {
    en: 'The memory service response exceeds the limit.',
    'zh-CN': '记忆服务响应超过限制。',
  },
  MEMORY_SERVICE_STOPPED: [
    { en: 'The memory service is stopped.', 'zh-CN': '记忆服务已停止。' },
    {
      match: '记忆服务已停止，请在系统设置 → 记忆中启动。',
      en: 'The memory service is stopped; start it under Settings → Memory.',
      'zh-CN': '记忆服务已停止，请在系统设置 → 记忆中启动。',
    },
    {
      match: '记忆服务已停止，请在系统设置 → 记忆中启动服务',
      en: 'The memory service is stopped; start it under Settings → Memory.',
      'zh-CN': '记忆服务已停止，请在系统设置 → 记忆中启动服务',
    },
    {
      match: '重启已被较新的启停操作取消',
      en: 'The restart was cancelled by a newer lifecycle operation.',
      'zh-CN': '重启已被较新的启停操作取消',
    },
    {
      match: '启动已被较新的停止操作取消',
      en: 'The start was cancelled by a newer stop operation.',
      'zh-CN': '启动已被较新的停止操作取消',
    },
  ],
  MEMORY_SERVICE_TIMEOUT: [
    { en: 'The memory service timed out; try again later.', 'zh-CN': '记忆服务响应超时，请稍后重试。' },
    {
      match: '记忆服务未能及时启动，请检查依赖和服务状态',
      en: 'The memory service did not start in time; check its dependencies and status.',
      'zh-CN': '记忆服务未能及时启动，请检查依赖和服务状态',
    },
    {
      match: '停止尚未完成，请查询 status；不会强杀进程',
      en: 'The stop is still in progress; check status (processes are not force-killed).',
      'zh-CN': '停止尚未完成，请查询 status；不会强杀进程',
    },
  ],
  MEMORY_VERSION_CONFLICT: {
    en: 'The memory service identity or protocol is incompatible; restart the service.',
    'zh-CN': '记忆服务身份或协议不兼容，请重启服务。',
  },
  NOT_FOUND: [
    { match: '记忆已删除。', en: 'The memory was deleted.', 'zh-CN': '记忆已删除。' },
    {
      match: '记忆引用来自其他数据库。',
      en: 'The memory reference comes from another database.',
      'zh-CN': '记忆引用来自其他数据库。',
    },
    {
      match: '记忆已删除或已被替代。',
      en: 'The memory was deleted or superseded.',
      'zh-CN': '记忆已删除或已被替代。',
    },
  ],
  READ_ONLY: [
    { en: 'The current context is read-only for memories.', 'zh-CN': '当前上下文只允许读取记忆。' },
    {
      match: '此 Agent 只能读取记忆。',
      en: 'This Agent can only read memories.',
      'zh-CN': '此 Agent 只能读取记忆。',
    },
    {
      match: '当前模式未启用记忆召回。',
      en: 'Memory recall is not enabled in the current mode.',
      'zh-CN': '当前模式未启用记忆召回。',
    },
  ],
  REVISION_CONFLICT: [
    {
      match: '记忆已更新，请刷新后重试。',
      en: 'The memory changed; refresh and try again.',
      'zh-CN': '记忆已更新，请刷新后重试。',
    },
    {
      match: '记忆整理请求正在执行。',
      en: 'A memory organization request is already running.',
      'zh-CN': '记忆整理请求正在执行。',
    },
    {
      match: '请求标识已用于不同内容。',
      en: 'The request identity was already used for different content.',
      'zh-CN': '请求标识已用于不同内容。',
    },
    {
      match: '同一事实已存在，请读取后修订。',
      en: 'The same fact already exists; read it and revise instead.',
      'zh-CN': '同一事实已存在，请读取后修订。',
    },
  ],
  STORE_UNAVAILABLE: [
    {
      en: 'Memory storage is temporarily unavailable; try again later.',
      'zh-CN': '记忆存储暂不可用，请稍后重试。',
    },
    { match: '记忆整理繁忙。', en: 'Memory organization is busy.', 'zh-CN': '记忆整理繁忙。' },
    {
      match: '记忆数据库正在升级，请稍后重试。',
      en: 'The memory database is upgrading; try again later.',
      'zh-CN': '记忆数据库正在升级，请稍后重试。',
    },
    {
      match: '记忆数据库尚未初始化。',
      en: 'The memory database is not initialized yet.',
      'zh-CN': '记忆数据库尚未初始化。',
    },
    { match: '记忆正文缺失。', en: 'The memory content is missing.', 'zh-CN': '记忆正文缺失。' },
    {
      match: '记忆数据库不可用，请检查存储权限或稍后重试。',
      en: 'The memory database is unavailable; check storage permissions or try again later.',
      'zh-CN': '记忆数据库不可用，请检查存储权限或稍后重试。',
    },
    { match: '记忆数据库繁忙。', en: 'The memory database is busy.', 'zh-CN': '记忆数据库繁忙。' },
    {
      match: '记忆服务不可用，请稍后重试。',
      en: 'The memory service is unavailable; try again later.',
      'zh-CN': '记忆服务不可用，请稍后重试。',
    },
    {
      match: '记忆服务连接中断；写入结果请刷新确认。',
      en: 'The memory service connection dropped; refresh to confirm the write result.',
      'zh-CN': '记忆服务连接中断；写入结果请刷新确认。',
    },
  ],
};

/**
 * Merges the memory-domain catalog into the shared error-message registry at Server boot.
 */
export function registerMemoryErrorMessages(): void {
  registerErrorMessages('memory', memoryErrorMessages);
}
