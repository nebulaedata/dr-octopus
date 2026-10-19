/**
 * @author Codex
 * @description Presents recoverable startup failures, explicit reset confirmation and durable Main-owned maintenance progress.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
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
import { CircleAlertIcon, CircleCheckIcon, CopyIcon } from 'lucide-react';
import { maintenanceQuery } from '@/queries/maintenance-queries';
import { maintenanceAction } from '@/api/maintenance';
import type { MaintenanceAction } from '../../../../contracts/maintenance';

/**
 * Displays only safe recovery metadata; action availability and data selection remain owned by Main.
 */
export function RuntimeRecoveryAlert({ onConnect }: { onConnect: () => void }) {
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
  /**
   * Sends the currently observed lifecycle revision; destructive confirmation captures its own revision separately.
   */
  function request(kind: MaintenanceAction['action']) {
    action.mutate({ action: kind, revision });
  }
  return (
    <>
      <Alert
        variant={busy || succeeded ? 'default' : 'destructive'}
        className="gap-y-3 has-data-[slot=alert-action]:pr-2.5"
        data-testid="runtime-recovery-alert"
      >
        {busy ? <Spinner /> : succeeded ? <CircleCheckIcon /> : <CircleAlertIcon />}
        <AlertTitle>
          {busy ? '正在恢复执行服务' : succeeded ? '执行服务已恢复' : '执行服务无法启动'}
        </AlertTitle>
        <AlertDescription className="min-w-0">
          <div className="flex flex-col gap-2">
            <p role={busy ? 'status' : undefined}>{state.message || state.issue?.description}</p>
            {action.error ? <p>{action.error.message}</p> : null}
          </div>
        </AlertDescription>
        <AlertAction className="static col-start-2 flex flex-wrap gap-2">
          {busy ? (
            <Button size="sm" disabled>
              <Spinner data-icon="inline-start" />
              处理中…
            </Button>
          ) : succeeded ? (
            <>
              <Button size="sm" onClick={onConnect}>
                前往连接
              </Button>
              {state.backupPath ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => request('open-backup')}
                >
                  打开备份位置
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => request('dismiss')}>
                关闭提示
              </Button>
            </>
          ) : (
            <>
              {state.issue?.recoverable ? (
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    setConfirmedIssue({ revision, impact: state.issue!.impact! });
                    setConfirming(true);
                  }}
                >
                  备份并重置
                </Button>
              ) : null}
              {state.issue ? (
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => request('retry')}>
                  重试启动
                </Button>
              ) : null}
              {state.backupPath ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => request('open-backup')}
                >
                  打开备份位置
                </Button>
              ) : null}
            </>
          )}
        </AlertAction>
        {!busy && !succeeded ? (
          <Collapsible className="col-start-2 min-w-0">
            <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>查看详情</CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="flex flex-col gap-2 text-sm">
                <p>{state.issue?.title}</p>
                <p>{state.issue?.description}</p>
                <p>错误码：{state.issue?.code ?? 'MAINTENANCE_FAILED'}</p>
                {state.backupPath ? <p className="break-all">备份位置：{state.backupPath}</p> : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={disabled}
                  onClick={() => request('copy-details')}
                >
                  <CopyIcon data-icon="inline-start" />
                  复制错误信息
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
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
