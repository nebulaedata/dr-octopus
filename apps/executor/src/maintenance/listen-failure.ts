/**
 * @author Codex
 * @description Explains listener failures with endpoint-specific causes and explicit settings recovery steps.
 */
import type { ListenFailure } from '../contracts/listen-failure';

/**
 * Converts safe system diagnostics to user guidance without guessing a replacement address or changing settings.
 */
export function explainListenFailure(failure: ListenFailure): {
  title: string;
  description: string;
  guidance: string;
} {
  const endpoint = `${failure.address}:${failure.port}`;
  const guidance =
    '前往「设置 → 服务接入」，检查 MCP 服务端口和本机内网 / VPN IPv4 地址。保存后重新启动应用；仅重试不会解决无效的配置。';
  if (failure.systemCode === 'EADDRNOTAVAIL') {
    return {
      title: '配置的监听地址不可用',
      description: `无法监听 ${endpoint}：该 IP 地址当前不可用于本机监听，可能是切换网络或断开 VPN 后地址发生了变化。`,
      guidance:
        '前往「设置 → 服务接入」，将「本机内网 / VPN IPv4 地址」改为本机当前地址；如果只在本机使用，请关闭「允许内网 / VPN 客户端连接」。保存后重新启动应用。',
    };
  }
  if (failure.systemCode === 'EADDRINUSE') {
    return {
      title: '执行服务端口已被占用',
      description: `无法监听 ${endpoint}：该地址和端口已被其他程序使用。`,
      guidance:
        '关闭占用此端口的程序后重试，或前往「设置 → 服务接入」修改「MCP 服务端口」，保存后重新启动应用，并更新客户端连接地址。',
    };
  }
  if (failure.systemCode === 'EACCES' || failure.systemCode === 'EPERM') {
    return {
      title: '系统拒绝监听服务地址',
      description: `无法监听 ${endpoint}：操作系统拒绝绑定此地址和端口。`,
      guidance:
        '检查系统的端口限制及安全软件策略，或前往「设置 → 服务接入」修改「MCP 服务端口」，保存后重新启动应用，并更新客户端连接地址。',
    };
  }
  return {
    title: '无法打开执行服务监听地址',
    description: `无法监听 ${endpoint}，请展开技术详情查看系统错误码。`,
    guidance,
  };
}
