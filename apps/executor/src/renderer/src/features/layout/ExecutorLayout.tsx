/**
 * @author Codex
 * @description Owns page navigation and persistent query, clipboard and global feedback lifecycles for the Executor shell.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from '@octopus/ui/components/toast';
import { Tabs, TabsContent } from '@octopus/ui/components/tabs';
import { Alert } from '@octopus/custom-ui/components/alert';
import { runtimeStatusQuery } from '@/queries/runtime-queries';
import { accessQuery } from '@/queries/access-queries';
import { copyEndpoint } from '@/api/executor';
import { ConnectionPage } from '@/features/connection';
import { SettingsPage } from '@/features/settings';
import { StatusPage } from '@/features/status';
import { PendingRestartAlert } from './PendingRestartAlert';
import { ExecutorTitleBar } from './ExecutorTitleBar';
import { ExecutorScrollArea } from './ExecutorScrollArea';
import { maintenanceQuery } from '@/queries/maintenance-queries';

/**
 * Keeps page selection local while Runtime snapshots remain authoritative for every displayed service and session state.
 */
export function ExecutorLayout() {
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [tab, setTab] = useState<string>('status');
  const [focusServiceSettings, setFocusServiceSettings] = useState(false);
  const runtime = useQuery(runtimeStatusQuery);
  const maintenance = useQuery(maintenanceQuery);
  const ready = runtime.data?.state === 'ready' && runtime.data.health.state === 'healthy';
  const access = useQuery({ ...accessQuery, enabled: ready, refetchInterval: 2000 });
  const copy = useMutation({
    mutationFn: copyEndpoint,
    networkMode: 'always',
    retry: false,
    onSuccess: () => toast.add({ id: 'copy-endpoint', type: 'success', title: '连接地址已复制' }),
    onError: (error) => toast.add({ id: 'copy-endpoint', type: 'error', title: error.message }),
  });
  const { isSuccess: copied, reset: resetCopy } = copy;
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(resetCopy, 2000);
    return () => window.clearTimeout(timer);
  }, [copied, resetCopy]);
  const known = ready && !access.isError && !!access.data;
  const error = runtime.error ?? access.error;
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setFocusServiceSettings(false);
        setTab(String(value));
      }}
      className="executor-shell gap-0 bg-background text-foreground"
    >
      <ExecutorTitleBar />
      <ExecutorScrollArea>
        <div className="mx-auto flex w-full max-w-6xl flex-col px-5 py-8 sm:px-12">
          <PendingRestartAlert hasUnsavedChanges={settingsDirty} />
          <TabsContent value="status" className="flex flex-col gap-7">
            <StatusPage
              runtime={runtime.data}
              access={access.data}
              accessError={access.isError}
              maintenance={maintenance.data}
              copy={{ isPending: copy.isPending, isSuccess: copy.isSuccess, mutate: () => copy.mutate() }}
              onConnect={() => setTab('connections')}
              onNetworkSettings={() => {
                setFocusServiceSettings(true);
                setTab('settings');
              }}
            />
          </TabsContent>
          <TabsContent value="connections" className="flex flex-col gap-7">
            <ConnectionPage ready={ready} browser={known ? access.data!.browser : undefined} />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsPage onDirtyChange={setSettingsDirty} focusService={focusServiceSettings} />
          </TabsContent>
          {runtime.data?.computerUse && runtime.data.computerUse.state !== 'idle' ? (
            <Alert
              className="mt-5"
              variant={runtime.data.computerUse.state === 'unknown' ? 'danger' : 'warning'}
              showIcon
              description={
                runtime.data.computerUse.state === 'unknown'
                  ? '桌面控制状态未知，请确认执行已结束。'
                  : '桌面控制工具正在操作此电脑，请暂勿使用鼠标键盘。'
              }
            />
          ) : null}
          {error ? <Alert className="mt-5" variant="danger" showIcon description={error.message} /> : null}
        </div>
      </ExecutorScrollArea>
    </Tabs>
  );
}
