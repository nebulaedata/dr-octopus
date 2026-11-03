/**
 * @author Codex
 * @description Presents service health, client sessions, recovery and tool availability on the status page.
 */
import { ChevronRightIcon, CopyIcon, CheckIcon, UsersIcon, BotIcon, CircleIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Badge } from '@octopus/ui/components/badge';
import { Spinner } from '@octopus/ui/components/spinner';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@octopus/ui/components/collapsible';
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@octopus/ui/components/input-group';
import type { RuntimeSnapshot } from '../../../../contracts/runtime';
import type { AccessSnapshot } from '../../../../contracts/access';
import type { MaintenanceSnapshot } from '../../../../contracts/maintenance';
import { RuntimeRecoveryAlert } from './RuntimeRecoveryAlert';
import { ToolOverview } from './ToolOverview';

const labels = {
  stopped: '已停止',
  starting: '启动中',
  ready: '已启动',
  stopping: '退出中',
  failed: '异常',
} as const;

/**
 * Projects shell-owned snapshots and actions without creating another polling or clipboard lifecycle.
 */
export function StatusPage({
  runtime,
  access,
  accessError,
  maintenance,
  copy,
  onConnect,
  onNetworkSettings,
}: {
  runtime?: RuntimeSnapshot;
  access?: AccessSnapshot;
  accessError: boolean;
  maintenance?: MaintenanceSnapshot;
  copy: { isPending: boolean; isSuccess: boolean; mutate: () => void };
  onConnect: () => void;
  onNetworkSettings: () => void;
}) {
  const ready = runtime?.state === 'ready' && runtime.health.state === 'healthy';
  const starting = runtime?.state === 'starting';
  const known = ready && !accessError && !!access;
  const showRecovery = !!maintenance && (!!maintenance.issue || maintenance.phase !== 'idle');
  const catalog = known ? access?.toolCatalog : undefined;
  const clients = known
    ? access!.connections.map((connection) => ({
        ...connection,
        label:
          access!.clients.find((client) => client.clientId === connection.clientId)?.label ?? '已授权客户端',
      }))
    : [];
  let clientDescription = '执行服务就绪后可查看客户端会话。';
  if (known) {
    clientDescription = clients.length
      ? '以下客户端持有有效 MCP 会话。'
      : '暂无有效 MCP 会话，可在「管理授权」获取连接配置。';
  } else if (ready && accessError) {
    clientDescription = '会话状态暂不可用，可在「管理授权」查看客户端配置。';
  } else if (ready) {
    clientDescription = '正在读取客户端会话…';
  }
  let statusTitle = runtime?.message ?? '正在读取服务状态…';
  if (runtime?.health.state === 'unresponsive') {
    statusTitle = '执行服务暂未响应';
  } else if (ready) {
    statusTitle = 'MCP 服务已启动';
  }
  let browserStatus = '状态未知';
  let browserDetail = '暂时无法读取浏览器状态。';
  let browserVariant: 'secondary' | 'success' | 'warning' | 'destructive' = 'secondary';
  if (known) {
    const browser = access!.browser;
    browserStatus = '未启用';
    browserDetail = '连接 Chrome / Edge 扩展，让智能体调用浏览器工具。';
    if (browser.enabled) {
      browserStatus = '等待连接';
      browserDetail = '桥接已启用，等待浏览器扩展连接。';
      const connectedCount = browser.connections.filter(
        (connection) => connection.state === 'connected'
      ).length;
      if (connectedCount > 0) {
        browserStatus = `${connectedCount} 项已连接`;
        browserVariant = 'secondary';
        browserDetail = '扩展已连接，浏览器工具尚未就绪。';
        if (
          browser.connections.some(
            (connection) => connection.state === 'connected' && connection.toolsAvailable
          )
        ) {
          browserVariant = 'success';
          browserDetail = '让智能体调用 Chrome / Edge 浏览器工具。';
        }
      } else if (browser.connections.some((connection) => connection.state === 'incompatible')) {
        browserStatus = '版本不兼容';
        browserVariant = 'destructive';
        browserDetail = '请更新执行器和浏览器扩展。';
      } else if (browser.connections.length) {
        browserStatus = '连接断开';
        browserVariant = 'warning';
        browserDetail = '打开浏览器扩展检查连接。';
      }
    }
  }
  const computer = runtime?.capabilities.computer;
  let computerStatus = '状态未知';
  let computerDetail = '正在读取桌面工具状态…';
  let computerVariant: 'secondary' | 'success' | 'warning' | 'destructive' = 'secondary';
  if (computer) {
    computerDetail = computer.reason;
    const computerLabels = {
      stopped: '未就绪',
      starting: '启动中',
      ready: '已就绪',
      failed: '启动失败',
      unavailable: '不可用',
      stopping: '停止中',
      closed: '已停止',
    } as const;
    computerStatus = computerLabels[computer.state];
    if (computer.available && ready) {
      computerVariant = 'success';
      computerDetail = '查看本机桌面或控制鼠标与键盘，使用前需显式授权。';
    } else if (runtime?.health.state === 'unresponsive') {
      computerStatus = '状态未知';
      computerDetail = '执行服务暂未响应，无法确认桌面工具状态。';
      computerVariant = 'warning';
    } else if (computer.state === 'failed') {
      computerVariant = 'destructive';
    } else if (computer.state === 'unavailable') {
      computerVariant = 'warning';
    }
  }
  const endpoint = known
    ? (access!.remoteEndpoint ?? access!.endpoint ?? '连接地址暂不可用')
    : '连接地址暂不可用';
  let statusIndicator = <Badge variant="secondary">未就绪</Badge>;
  if (starting || ready) {
    statusIndicator = (
      <span className="flex size-6 shrink-0 items-center justify-center">
        {starting ? (
          <Spinner aria-label="执行服务正在启动" className="size-5 motion-reduce:animate-none" />
        ) : (
          <CircleIcon className="size-3 fill-current text-success" aria-label="运行中" />
        )}
      </span>
    );
  }
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">运行状态</h1>
        <p className="text-sm text-muted-foreground">查看执行服务与本机工具的可用情况。</p>
      </div>
      <RuntimeRecoveryAlert onConnect={onConnect} onNetworkSettings={onNetworkSettings} />
      <Collapsible
        hidden={showRecovery && maintenance?.phase !== 'succeeded'}
        defaultOpen={false}
        className="rounded-xl bg-muted/40 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            {statusIndicator}
            <div className="flex flex-col gap-1.5">
              <h2 className="text-base font-semibold">{statusTitle}</h2>
              <p className="text-sm text-muted-foreground">
                {ready ? '基础工具服务已就绪。' : '服务就绪后可接入客户端。'}
              </p>
              <span className="sr-only" data-testid="runtime-state">
                {runtime ? labels[runtime.state] : '读取中'}
              </span>
            </div>
          </div>
          <CollapsibleTrigger render={<Button variant="ghost" className="group" />}>
            服务详情
            <ChevronRightIcon
              data-icon="inline-end"
              className="motion-safe:transition-transform group-aria-expanded:rotate-90"
            />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="pt-4">
          <InputGroup className="max-w-xl min-w-xs w-fit ml-8">
            <InputGroupInput
              aria-label="MCP 连接地址"
              readOnly
              value={endpoint}
              data-testid="mcp-endpoint"
              className="font-mono"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                aria-label="复制连接地址"
                disabled={!known || copy.isPending}
                onClick={() => copy.mutate()}
              >
                {copy.isSuccess ? <CheckIcon /> : <CopyIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>

          <section aria-label="客户端会话" className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
              <div className="flex min-w-0 items-start gap-3">
                <UsersIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="text-base font-semibold">客户端会话</h3>
                  <p className="text-sm text-muted-foreground" role="status">
                    {clientDescription}
                  </p>
                </div>
              </div>
              <Button variant="ghost" className="shrink-0 self-end sm:self-start" onClick={onConnect}>
                管理授权
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
            {clients.length ? (
              <ul aria-label="有效会话客户端" className="flex flex-wrap gap-2 pl-8">
                {clients.map((client) => (
                  <li
                    key={client.clientId}
                    className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
                  >
                    <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate text-sm" title={client.label}>
                      {client.label}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </CollapsibleContent>
      </Collapsible>
      <ToolOverview
        catalog={catalog}
        policyRevision={known ? access?.toolPolicyRevision : undefined}
        browser={{ label: browserStatus, variant: browserVariant, description: browserDetail }}
        computer={{ label: computerStatus, variant: computerVariant, description: computerDetail }}
        onManageBrowser={onConnect}
      />
    </>
  );
}
