/**
 * @author Codex
 * @description Presents recoverable startup failures, explicit reset confirmation and durable Main-owned maintenance progress.
 */
import { useState } from 'react';
import { cn } from '@octopus/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, CopyIcon, RotateCwIcon } from 'lucide-react';
import { maintenanceQuery } from '@/queries/maintenance-queries';
import { maintenanceAction } from '@/api/maintenance';
import type { MaintenanceAction } from '../../../../contracts/maintenance';

/**
 * Displays only safe recovery metadata; action availability and data selection remain owned by Main.
 */
export function RuntimeRecoveryAlert({
  onConnect,
  onNetworkSettings,
}: {
  onConnect: () => void;
  onNetworkSettings: () => void;
}) {
  const cache = useQueryClient();
  const query = useQuery(maintenanceQuery);
  const [confirming, setConfirming] = useState(false);
  const [confirmedIssue, setConfirmedIssue] = useState<{ revision: number; impact: string } | null>(null);
  const action = useMutation({
    mutationFn: maintenanceAction,
    networkMode: 'always',
    retry: false,
    onSuccess: (_data, input) => {
      if (input.action === 'copy-details') {
        toast.add({ type: 'success', title: '错误信息已复制' });
      }
    },
    onSettled: () => cache.invalidateQueries({ queryKey: ['executor'] }),
  });
  const state = query.data;
  if (!state || (!state.issue && state.phase === 'idle')) {
    return null;
  }
  const busy = ['stopping', 'backing-up', 'resetting', 'starting'].includes(state.phase);
  const succeeded = state.phase === 'succeeded' && !state.issue;
  const disabled = busy || action.isPending;
  const revision = state.issue?.revision ?? 0;
  let title = state.issue?.title || '执行服务启动失败';
  if (busy) {
    title = '正在恢复执行服务';
  } else if (succeeded) {
    title = '执行服务已恢复';
  }
  let reason = state.message || state.issue?.description || '请重试启动执行服务。';
  if (!busy && !succeeded && state.issue?.listenFailure) {
    reason = state.issue.description;
  }
  const description = busy || succeeded ? reason : `${reason.replace(/[。…]+$/u, '')}。本地工具暂时不可用。`;
  const details = [...new Set([state.issue?.title, state.issue?.description])].filter(
    (text) => text && text !== reason && !['执行服务无法启动', title].includes(text)
  );
  /**
   * Sends the currently observed lifecycle revision; destructive confirmation captures its own revision separately.
   */
  function request(kind: MaintenanceAction['action']) {
    action.mutate({ action: kind, revision });
  }
  let statusIcon = <CircleAlertIcon className="size-5" />;
  if (busy) {
    statusIcon = <Spinner />;
  } else if (succeeded) {
    statusIcon = <CircleCheckIcon className="size-5" />;
  }
  let controls;
  if (busy) {
    controls = (
      <Button disabled>
        <Spinner data-icon="inline-start" />
        处理中…
      </Button>
    );
  } else if (succeeded) {
    controls = (
      <>
        <Button onClick={onConnect}>前往连接</Button>
        {state.backupPath ? (
          <Button variant="outline" disabled={disabled} onClick={() => request('open-backup')}>
            打开备份位置
          </Button>
        ) : null}
        <Button variant="ghost" disabled={disabled} onClick={() => request('dismiss')}>
          关闭提示
        </Button>
      </>
    );
  } else {
    controls = (
      <>
        {state.issue?.listenFailure ? (
          <Button disabled={disabled} onClick={onNetworkSettings}>
            前往网络配置
          </Button>
        ) : null}
        {state.issue ? (
          <Button
            variant={state.issue.listenFailure ? 'outline' : 'default'}
            disabled={disabled}
            onClick={() => request('retry')}
          >
            <RotateCwIcon data-icon="inline-start" />
            重试启动
          </Button>
        ) : null}
        {state.issue?.recoverable ? (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setConfirmedIssue({ revision, impact: state.issue!.impact! });
              setConfirming(true);
            }}
          >
            备份并重置
          </Button>
        ) : null}
        <CollapsibleTrigger render={<Button variant="outline" className="group" />}>
          技术详情
          <ChevronRightIcon
            data-icon="inline-end"
            className="motion-safe:transition-transform group-aria-expanded:rotate-90"
          />
        </CollapsibleTrigger>
      </>
    );
  }
  return (
    <>
      <Alert className="rounded-xl p-5 sm:p-6" data-testid="runtime-recovery-alert">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              busy || succeeded ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive'
            )}
            aria-hidden="true"
          >
            {statusIcon}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <AlertTitle>
              <h2 className="text-lg font-semibold">{title}</h2>
            </AlertTitle>
            <AlertDescription className="break-words">
              <span role={busy ? 'status' : undefined}>{description}</span>
            </AlertDescription>
            {!busy && !succeeded && state.issue?.guidance ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{state.issue.guidance}</p>
            ) : null}
            {action.error ? (
              <p className="text-sm text-destructive" role="alert">
                {action.error.message}
              </p>
            ) : null}
            <Collapsible className="min-w-0">
              <div className="mt-2 flex flex-wrap items-center gap-2">{controls}</div>
              {!busy && !succeeded ? (
                <CollapsibleContent className="pt-4">
                  <div className="flex flex-col items-start gap-3 rounded-lg bg-muted/50 p-4 text-sm">
                    {details.map((text) => (
                      <p key={text} className="break-words text-muted-foreground">
                        {text}
                      </p>
                    ))}
                    <dl className="flex min-w-0 flex-col gap-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <dt className="text-muted-foreground">应用错误码</dt>
                        <dd className="break-all font-mono">{state.issue?.code ?? 'MAINTENANCE_FAILED'}</dd>
                      </div>
                      {state.issue?.listenFailure ? (
                        <>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            <dt className="text-muted-foreground">失败阶段</dt>
                            <dd>MCP 服务监听</dd>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            <dt className="text-muted-foreground">监听地址</dt>
                            <dd className="break-all font-mono">
                              {state.issue.listenFailure.address}:{state.issue.listenFailure.port}
                            </dd>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            <dt className="text-muted-foreground">系统错误码</dt>
                            <dd className="break-all font-mono">{state.issue.listenFailure.systemCode}</dd>
                          </div>
                        </>
                      ) : null}
                      {state.backupPath ? (
                        <div className="flex min-w-0 flex-col gap-1">
                          <dt className="text-muted-foreground">备份位置</dt>
                          <dd className="break-all">{state.backupPath}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" disabled={disabled} onClick={() => request('copy-details')}>
                        <CopyIcon data-icon="inline-start" />
                        复制错误信息
                      </Button>
                      {state.backupPath ? (
                        <Button variant="outline" disabled={disabled} onClick={() => request('open-backup')}>
                          打开备份位置
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CollapsibleContent>
              ) : null}
            </Collapsible>
          </div>
        </div>
      </Alert>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>备份并重置相关数据？</DialogTitle>
            <DialogDescription>{confirmedIssue?.impact}完成后将自动重启执行服务。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button
              disabled={disabled}
              onClick={() => {
                if (confirmedIssue) {
                  action.mutate({ action: 'reset', revision: confirmedIssue.revision });
                  setConfirming(false);
                }
              }}
            >
              备份并重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
