/**
 * @author Codex
 * @description Presents optional client setup separately from grant creation, with credential-free previews and finite Main actions.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { toast } from '@octopus/ui/components/toast';
import { ToggleGroup, ToggleGroupItem } from '@octopus/ui/components/toggle-group';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { CopyIcon, DownloadIcon, CircleAlertIcon, CheckIcon } from 'lucide-react';
import { clientConfigurationQuery } from '@/queries/access-queries';
import { copyAgentGuide, copyClientConfiguration, downloadClientConfiguration } from '@/api/executor';
import type { ClientConfigurationInput } from '../../../../contracts/client-configuration';
import { deviceConnectionKey, type DeviceIdentity } from '../../../../contracts/device-identity';

/**
 * Keeps connection method local to setup; previews and mutation replies never contain real credentials.
 */
export function ClientConfiguration({
  clientId,
  remoteAvailable,
  device,
}: {
  clientId: string;
  remoteAvailable: boolean;
  device: DeviceIdentity;
}) {
  const [transport, setTransport] = useState<ClientConfigurationInput['transport']>('http');
  const input = { clientId, transport };
  const query = useQuery(clientConfigurationQuery(input));
  const guide = useMutation({
    mutationFn: copyAgentGuide,
    networkMode: 'always',
    retry: false,
    onSuccess: () =>
      toast.add({
        id: 'copy-agent-guide',
        type: 'success',
        title: '连接文档已复制，可粘贴给智能体完成配置。',
      }),
    onError: (error) => toast.add({ id: 'copy-agent-guide', type: 'error', title: error.message }),
  });
  const copy = useMutation({
    mutationFn: copyClientConfiguration,
    networkMode: 'always',
    retry: false,
    onSuccess: () =>
      toast.add({ id: 'copy-configuration', type: 'success', title: '配置已复制，请粘贴到智能体客户端。' }),
    onError: (error) => toast.add({ id: 'copy-configuration', type: 'error', title: error.message }),
  });
  const { isSuccess: copied, reset: resetCopy } = copy;
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(resetCopy, 2000);
    return () => window.clearTimeout(timer);
  }, [copied, resetCopy]);
  const download = useMutation({
    mutationFn: downloadClientConfiguration,
    networkMode: 'always',
    retry: false,
    onSuccess: (downloaded) => {
      if (downloaded) {
        toast.add({ id: 'download-configuration', type: 'success', title: '配置文件已下载。' });
      }
    },
    onError: (error) => toast.add({ id: 'download-configuration', type: 'error', title: error.message }),
  });
  const busy = copy.isPending || guide.isPending || download.isPending;
  const error = query.error;
  return (
    <section aria-label="客户端配置" className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted/50 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">配置客户端</h3>
        <p className="text-sm text-muted-foreground">执行器 MCP 服务的配置</p>
        <p className="break-words text-sm">设备名称：{device.deviceName}</p>
        <p className="text-xs text-muted-foreground">设备改名不影响连接标识，重名时请核对设备 ID。</p>
        <p className="break-all text-xs text-muted-foreground">设备 ID：{device.deviceId}</p>
        <p className="break-all text-xs text-muted-foreground">连接标识：{deviceConnectionKey(device)}</p>
      </div>
      <ToggleGroup
        aria-label="客户端连接方式"
        variant="outline"
        value={[transport]}
        disabled={busy}
        onValueChange={(values) => {
          const value = values[0];
          if (value === 'http' || value === 'stdio' || value === 'remote-http') {
            setTransport(value);
            copy.reset();
            download.reset();
          }
        }}
      >
        <ToggleGroupItem value="http" className="aria-pressed:bg-background aria-pressed:shadow-xs">
          HTTP
        </ToggleGroupItem>
        <ToggleGroupItem value="stdio" className="aria-pressed:bg-background aria-pressed:shadow-xs">
          stdio
        </ToggleGroupItem>
        <ToggleGroupItem
          value="remote-http"
          disabled={!remoteAvailable}
          className="aria-pressed:bg-background aria-pressed:shadow-xs"
        >
          内网 / VPN HTTP
        </ToggleGroupItem>
      </ToggleGroup>
      {transport === 'stdio' ? (
        <p className="text-xs text-muted-foreground">
          适用于通过本地命令接入 MCP 的客户端，使用时保持执行器运行。
        </p>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-medium">MCP 配置</span>
        {query.isFetching ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取配置…
          </p>
        ) : null}
        {query.data ? (
          <pre
            className="max-h-52 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-4"
            tabIndex={0}
            aria-label="MCP 配置预览"
          >
            {query.data}
          </pre>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="w-full text-xs text-muted-foreground">
          配置及连接文档包含此授权的凭据，仅粘贴给可信客户端。
        </p>
        <Button
          variant="outline"
          disabled={!query.data || query.isError || busy}
          onClick={() => {
            download.reset();
            copy.mutate(input);
          }}
        >
          {copy.isSuccess ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copy.isPending ? '复制中…' : '复制配置'}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data || query.isError || busy}
          onClick={() => guide.mutate(input)}
        >
          <CopyIcon data-icon="inline-start" />
          {guide.isPending ? '复制中…' : '复制给智能体'}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data || query.isError || busy}
          onClick={() => {
            copy.reset();
            download.mutate(input);
          }}
        >
          <DownloadIcon data-icon="inline-start" />
          {download.isPending ? '下载中…' : '下载配置文件'}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
