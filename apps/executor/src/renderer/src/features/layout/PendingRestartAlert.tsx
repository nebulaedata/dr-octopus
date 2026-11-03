/**
 * @author Codex
 * @description Keeps saved restart-required settings visible across management pages and requests one complete application restart.
 */
import { useIsMutating, useMutation, useQuery } from '@tanstack/react-query';
import { Alert } from '@octopus/custom-ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { toast } from '@octopus/ui/components/toast';
import { RotateCwIcon } from 'lucide-react';
import { restartApplication } from '@/api/executor';
import { connectionSettingsQuery } from '@/queries/connection-settings-queries';

/**
 * Shows only persisted pending settings; unsaved drafts and in-flight saves cannot be discarded by this action.
 */
export function PendingRestartAlert({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }) {
  const query = useQuery(connectionSettingsQuery);
  const saving = useIsMutating({ mutationKey: connectionSettingsQuery.queryKey }) > 0;
  const restart = useMutation({
    mutationKey: ['executor', 'restart'],
    mutationFn: restartApplication,
    networkMode: 'always',
    retry: false,
    onError: (error) => toast.add({ id: 'restart-executor', type: 'error', title: error.message }),
  });
  if (!query.data?.pendingRestart) {
    return null;
  }
  const requested = restart.isPending || restart.isSuccess;
  return (
    <div className="sticky top-0 z-10 mb-6">
      <Alert
        className="shadow-md"
        variant="warning"
        showIcon
        title={<>已保存的设置待重启生效</>}
        description={
          hasUnsavedChanges
            ? '请先保存或撤销未保存的更改，再重启执行器。'
            : '重启后应用已保存的设置，并断开当前连接、停止任务。'
        }
        action={
          <Button
            type="button"
            variant="outline"
            disabled={saving || hasUnsavedChanges || requested}
            aria-busy={requested}
            onClick={() => restart.mutate()}
          >
            <RotateCwIcon />
            {requested ? '重启中…' : '立即重启'}
          </Button>
        }
      />
    </div>
  );
}
