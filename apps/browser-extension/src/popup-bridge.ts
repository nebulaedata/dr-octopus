/**
 * @author Codex
 * @description Defines extension-local popup diagnostics and connection controls without page execution or Runtime credentials.
 */
import { z } from 'zod';

export const bridgeFailureSchema = z.strictObject({
  at: z.iso.datetime(),
  code: z
    .string()
    .regex(/^[A-Za-z_]+$/)
    .max(64),
  method: z
    .enum([
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
    ])
    .nullable(),
  nativeReason: z.enum(['host_exited', 'host_not_found', 'access_forbidden', 'native_error']).nullable(),
});

export const popupRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bridge.status') }),
  z.strictObject({ type: z.literal('bridge.reconnect') }),
  z.strictObject({ type: z.literal('bridge.pause'), paused: z.boolean() }),
]);

export const popupStatusSchema = z.strictObject({
  phase: z.enum(['connected', 'connecting', 'disconnected', 'paused', 'incompatible']),
  code: z.string().max(64),
  toolsReady: z.boolean(),
  installationId: z.uuid().nullable(),
  lastFailure: bridgeFailureSchema.nullable().default(null),
});
export type PopupStatus = z.infer<typeof popupStatusSchema>;
export type PopupRequest = z.infer<typeof popupRequestSchema>;

/**
 * Converts finite connection evidence into concise guidance, never inferring that an extension is missing.
 */
export function statusDescription(status: PopupStatus): string {
  if (status.phase === 'paused') {
    return '已暂停连接。已派发的动作可能继续完成。';
  }
  if (status.phase === 'connected') {
    return '已连接本机 Executor，工具调用仍需在客户端授权。';
  }
  if (status.phase === 'connecting') {
    return '正在连接本机 Executor…';
  }
  if (status.phase === 'incompatible') {
    return '协议版本不兼容，请更新扩展与 Executor。';
  }
  if (status.code === 'DISABLED') {
    return '请在 Executor 客户端启用浏览器桥接。';
  }
  if (status.code === 'RUNTIME_OFFLINE') {
    return 'Executor 服务未运行，请打开客户端启动服务。';
  }
  if (status.code === 'native_host_unavailable') {
    return '无法连接本机服务，请检查 Executor 与浏览器 Host 注册。';
  }
  return '连接已断开，将自动重连；也可以手动重新连接。';
}
