/**
 * @author Codex
 * @description Displays Runtime-owned Browser connection and tool evidence with explicit consent and credential-free diagnostics.
 */
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@octopus/ui/components/tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { toast } from '@octopus/ui/components/toast';
import { ToggleGroup, ToggleGroupItem } from '@octopus/ui/components/toggle-group';
import { Badge } from '@octopus/ui/components/badge';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@octopus/ui/components/collapsible';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Item, ItemGroup, ItemContent, ItemTitle, ItemActions } from '@octopus/ui/components/item';
import { ChevronRightIcon, CircleAlert, Power, RefreshCw } from 'lucide-react';
import { BrowserBrandIcon } from './BrowserBrandIcon';
import { ConnectionBadge } from './ConnectionBadge';
import { ToolNameList } from './ToolNameList';
import {
  setBrowserEnabled,
  browserDiagnostics,
  configureBrowserHost,
  openBrowserExtensionFolder,
} from '@/api/executor';
import { accessQuery } from '@/queries/access-queries';
import type { BrowserBridgeSnapshot } from '@octopus/shared/protocol/browser-bridge';

/**
 * Keeps user consent separate from live connection status and tool availability.
 */
export function BrowserBridgeStatus({
  data,
  ready,
  toolNames,
}: {
  data?: BrowserBridgeSnapshot;
  ready: boolean;
  toolNames?: string[];
}) {
  const cache = useQueryClient();
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [browser, setBrowser] = useState<'chrome' | 'edge'>('chrome');
  const browserName = browser === 'edge' ? 'Edge' : 'Chrome';
  const diagnostics = useQuery({
    queryKey: ['executor', 'browser-diagnostics'],
    enabled: instructionsOpen && diagnosticsOpen,
    queryFn: browserDiagnostics,
    retry: false,
    networkMode: 'always',
  });
  const change = useMutation({
    mutationFn: setBrowserEnabled,
    retry: false,
    networkMode: 'always',
    onSuccess: (snapshot) => cache.setQueryData(accessQuery.queryKey, snapshot),
  });
  const setup = useMutation({
    mutationFn: configureBrowserHost,
    retry: false,
    networkMode: 'always',
    onSuccess: () =>
      toast.add({ id: 'browser-setup', type: 'success', title: '连接组件已配置，请在插件弹窗中重连。' }),
  });
  const folder = useMutation({
    mutationFn: openBrowserExtensionFolder,
    retry: false,
    networkMode: 'always',
    onSuccess: () =>
      toast.add({ id: 'browser-folder', type: 'success', title: '插件目录已打开，请在浏览器中确认加载。' }),
  });
  const connected =
    ready &&
    data?.enabled &&
    data.connections.some((item) => item.state === 'connected' && item.toolsAvailable);
  const states = { connected: '已连接', disconnected: '连接断开', incompatible: '版本不兼容' } as const;
  let bridgeMessage = '暂时无法读取桥接状态';
  let bridgeLabel = '状态未知';
  if (data) {
    bridgeLabel = data.enabled ? '已启用' : '未启用';
    if (!data.enabled) {
      bridgeMessage = '未启用：尚不接受浏览器连接。';
    } else if (!data.connections.length) {
      bridgeMessage = '等待插件连接：在浏览器中打开插件，检查连接状态。';
    } else {
      bridgeMessage = '以下状态来自实际扩展握手。';
    }
  }
  return (
    <section role="region" aria-label="浏览器桥接设置" className="flex flex-col gap-3">
      {toolNames?.length ? (
        <Collapsible className="order-last">
          <CollapsibleTrigger render={<Button variant="ghost" className="group -ml-2.5" />}>
            <ChevronRightIcon
              data-icon="inline-start"
              className="motion-safe:transition-transform group-aria-expanded:rotate-90"
            />
            浏览器工具 · {toolNames.length} 项
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <ToolNameList names={toolNames} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">浏览器桥接</h2>
          <ConnectionBadge variant={data?.enabled ? 'success' : 'secondary'}>{bridgeLabel}</ConnectionBadge>
        </div>
        <Button
          variant={data?.enabled ? 'destructive' : 'outline'}
          disabled={!ready || !data || change.isPending}
          onClick={() => change.mutate(!data!.enabled)}
        >
          <Power data-icon="inline-start" />
          {data?.enabled ? '关闭浏览器桥接' : '启用浏览器桥接'}
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-2">
            <BrowserBrandIcon browser="chrome" />
            Chrome
          </span>
          <span className="flex items-center gap-2">
            <BrowserBrandIcon browser="edge" />
            Edge
          </span>
        </div>
        <p className="text-sm text-muted-foreground">连接 Chrome / Edge 扩展，让智能体调用浏览器工具。</p>
        {data?.enabled || !data ? <p className="text-xs text-muted-foreground">{bridgeMessage}</p> : null}
        {data?.connections.length ? (
          <ItemGroup className="gap-3">
            {data.connections.map((item) => {
              const toolsReady = ready && data.enabled && item.state === 'connected' && item.toolsAvailable;
              let variant: 'secondary' | 'success' | 'warning' | 'destructive' = 'secondary';
              if (ready && data.enabled) {
                if (item.state === 'connected') {
                  variant = 'success';
                } else if (item.state === 'incompatible') {
                  variant = 'destructive';
                } else {
                  variant = 'warning';
                }
              }
              return (
                <Item key={item.installationId} variant="outline">
                  <BrowserBrandIcon browser={item.browser} />
                  <ItemContent>
                    <ItemTitle>
                      {item.browser === 'edge' ? 'Edge' : 'Chrome'} · {item.extensionVersion} ·{' '}
                      {item.installationId.slice(0, 8)}
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <ConnectionBadge
                      variant={variant}
                      description={
                        toolsReady ? '浏览器工具已就绪；每次操作都会校验当前网站的访问权限。' : undefined
                      }
                    >
                      {ready ? states[item.state] : '状态不可确认'}
                    </ConnectionBadge>
                    {ready && data.enabled && item.state === 'connected' && !item.toolsAvailable ? (
                      <Badge variant="warning">工具未就绪</Badge>
                    ) : null}
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        ) : null}
        <Collapsible
          open={instructionsOpen}
          onOpenChange={(open) => {
            setInstructionsOpen(open);
            if (!open) {
              setDiagnosticsOpen(false);
            }
          }}
        >
          <CollapsibleTrigger render={<Button variant="ghost" className="group -ml-2.5" />}>
            <ChevronRightIcon
              data-icon="inline-start"
              className="motion-safe:transition-transform group-aria-expanded:rotate-90"
            />
            安装与连接说明
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 pt-3 text-sm">
            <section aria-label="安装浏览器插件" className="flex flex-col gap-3">
              <h3 className="font-medium">1. 安装插件</h3>
              <Tabs defaultValue="local" className="gap-3">
                <TabsList aria-label="插件安装方式" className="w-fit">
                  <TabsTrigger value="store">应用商店安装</TabsTrigger>
                  <TabsTrigger value="local">本地安装</TabsTrigger>
                </TabsList>
                <TabsContent value="store" className="flex flex-col gap-3">
                  <p className="text-muted-foreground">通过官方商店添加插件；无法访问商店时使用本地安装。</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" disabled>
                      <BrowserBrandIcon browser="chrome" />
                      Chrome 商店 · 尚未上架
                    </Button>
                    <Button variant="outline" disabled>
                      <BrowserBrandIcon browser="edge" />
                      Edge 商店 · 尚未上架
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="local" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ToggleGroup
                      aria-label="选择浏览器"
                      variant="outline"
                      value={[browser]}
                      disabled={folder.isPending}
                      onValueChange={(values) => {
                        const choice = values[0];
                        if (choice === 'chrome' || choice === 'edge') {
                          setBrowser(choice);
                          folder.reset();
                        }
                      }}
                    >
                      {(['chrome', 'edge'] as const).map((choice) => (
                        <ToggleGroupItem key={choice} value={choice}>
                          <BrowserBrandIcon browser={choice} />
                          {choice === 'edge' ? 'Edge' : 'Chrome'}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <Button
                      variant="outline"
                      disabled={folder.isPending}
                      onClick={() => folder.mutate(browser)}
                    >
                      打开 {browserName} 插件目录
                    </Button>
                  </div>
                  <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
                    <li>在 {browserName} 菜单中打开“扩展 → 管理扩展”，开启“开发者模式”。</li>
                    <li>
                      点击“{browser === 'edge' ? '加载解压缩的扩展' : '加载已解压的扩展'}
                      ”，选择刚才打开的整个插件文件夹。
                    </li>
                  </ol>
                  <p className="text-xs text-muted-foreground">
                    无需访问商店。请保留插件目录；安装新版后在扩展管理页重新加载。
                  </p>
                  {folder.error ? (
                    <Alert variant="destructive">
                      <CircleAlert />
                      <AlertDescription>{folder.error.message}</AlertDescription>
                    </Alert>
                  ) : null}
                </TabsContent>
              </Tabs>
            </section>
            <section aria-label="连接浏览器插件" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">2. 连接执行器</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!ready || setup.isPending}
                    onClick={() => setup.mutate()}
                  >
                    {setup.isPending ? '正在配置…' : '配置浏览器连接'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!ready}
                    onClick={() => {
                      void cache.invalidateQueries({ queryKey: accessQuery.queryKey });
                    }}
                  >
                    <RefreshCw data-icon="inline-start" />
                    检查连接
                  </Button>
                </div>
              </div>
              <p className="text-muted-foreground">
                安装程序已配置连接。解压版或连接失败时点击“配置浏览器连接”，无需运行命令。
              </p>
              <p className="text-muted-foreground">
                启用右上方的浏览器桥接，在插件弹窗中恢复或重连，再查看上方实例状态。
              </p>
              {setup.error ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{setup.error.message}</AlertDescription>
                </Alert>
              ) : null}
              <p role="status" className="text-muted-foreground">
                {connected
                  ? '插件已连接，工具就绪。请在访问授权中选择浏览器能力，再配置客户端。'
                  : '实例连接且工具就绪后，在访问授权中选择浏览器能力，再配置客户端；如提示“工具未就绪”，请先检查插件权限。'}
              </p>
            </section>
            <div className="flex flex-col gap-3 text-muted-foreground">
              <details className="executor-disclosure group/help">
                <summary className="flex min-h-8 w-fit cursor-pointer items-center gap-2 rounded-md px-1 hover:text-foreground focus-visible:outline focus-visible:outline-ring">
                  <ChevronRightIcon
                    className="size-4 motion-safe:transition-transform group-open/help:rotate-90"
                    aria-hidden="true"
                  />
                  连接不上怎么办？
                </summary>
                <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">
                  <li>没有连接：确认当前浏览器配置中的插件已启用，打开插件弹窗恢复或重连。</li>
                  <li>配置失败：检查安装包是否完整；其他安装占用时，先通过原安装卸载或撤销配置。</li>
                  <li>版本不兼容：更新执行器和插件，本地安装需重新加载。</li>
                  <li>工具未就绪：检查插件的网站访问权限，在普通网页重试。</li>
                </ul>
              </details>
              <details
                className="executor-disclosure group/diagnostics"
                onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
              >
                <summary className="flex min-h-8 w-fit cursor-pointer items-center gap-2 rounded-md px-1 hover:text-foreground focus-visible:outline focus-visible:outline-ring">
                  <ChevronRightIcon
                    className="size-4 motion-safe:transition-transform group-open/diagnostics:rotate-90"
                    aria-hidden="true"
                  />
                  高级诊断
                </summary>
                <div className="mt-3 flex flex-col gap-2">
                  {diagnostics.isFetching ? <p>正在检查连接组件…</p> : null}
                  {diagnostics.data ? (
                    <>
                      <p>
                        {diagnostics.data.resourcesAvailable
                          ? '连接组件文件存在；实际连接以上方实例状态为准。'
                          : '连接组件缺失，请使用完整安装包重新安装。'}
                      </p>
                      <p className="break-all">资源目录：{diagnostics.data.resourceRoot}</p>
                      <p className="break-all">执行器数据目录：{diagnostics.data.projectRoot}</p>
                    </>
                  ) : null}
                  {diagnostics.error ? <p role="alert">{diagnostics.error.message}</p> : null}
                </div>
              </details>
            </div>
          </CollapsibleContent>
        </Collapsible>
        {change.error ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{change.error.message}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
