/**
 * @author Codex
 * @description Owns the finite recovery inventory and user impact independently of business initialization and UI.
 */
export const recoveryUnits = [
  {
    code: 'CONTROL_STORE_INVALID',
    title: '授权与任务数据无法读取',
    description: '检测到授权与任务数据不兼容或损坏。备份并重置后，可重新连接客户端并授权。',
    impact: '将备份并重置授权、客户端连接配置和任务历史。需要重新连接并授权；设备身份及其他设置保留。',
    // Remove credentials first; the invalid control journal continues to block admission until the final move.
    entries: ['connections', 'tasks'],
  },
] as const;
