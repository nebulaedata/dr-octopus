/**
 * @author Codex
 * @description Presents persistent task authority for explicit user review and revocation.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@octopus/ui/components/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@octopus/ui/components/collapsible';
import { ScheduleToolPicker } from './ScheduleToolPicker';
import { ScheduleDialogContent, ScheduleDialogBody } from './ScheduleDialog';
import { previewTaskAuthorization, mutateScheduledTask } from '@/api/scheduled-tasks';
import { useI18n } from '@/i18n/use-i18n';
import { ChevronDownIcon, UserShieldIcon } from 'lucide-react';
import type { ScheduledTask } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Keep permission selection local while all persisted authority comes from the Agent response.
 */
export function ScheduleAuthorization({
  task,
  workspaceId,
  defaultOpen = false,
  onClose,
}: {
  task: ScheduledTask;
  workspaceId: string;
  defaultOpen?: boolean;
  /**
   * Clears the route-owned review request after dismissal or successful authorization.
   */
  onClose?(): void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { t } = useI18n();
  const [reviewRevision, setReviewRevision] = useState(task.revision);
  const [selectionOverride, setSelected] = useState<string[] | null>(null);
  const queries = useQueryClient();
  const preview = useQuery({
    queryKey: ['schedule-authorization', workspaceId, task.id, reviewRevision],
    queryFn: ({ signal }) => previewTaskAuthorization(workspaceId, task.id, signal),
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // An explicit empty selection must remain empty even when the preview refreshes.
  const selected = selectionOverride ?? preview.data?.authorizedToolIdentities ?? [];
  const mutation = useMutation({
    mutationFn: ({ revoke, key }: { revoke: boolean; key: string }) =>
      mutateScheduledTask(workspaceId, {
        operation: revoke ? 'revoke-authorization' : 'authorize',
        taskId: task.id,
        revision: task.revision,
        key,
        ...(revoke
          ? {}
          : {
              input: {
                confirmed: true,
                executionDigest: preview.data!.executionDigest,
                tools: preview
                  .data!.tools.filter((tool) => !tool.unavailableReason && selected.includes(tool.identity))
                  .map(({ name, identity, description }) => ({ name, identity, description })),
              },
            }),
      }),
    onSuccess: async () => {
      setOpen(false);
      setSelected(null);
      onClose?.();
      await queries.invalidateQueries({ queryKey: ['scheduled-tasks'] });
    },
  });
  const authorizing = mutation.isPending && !mutation.variables?.revoke;
  const revoking = mutation.isPending && Boolean(mutation.variables?.revoke);
  const tools = preview.data?.tools ?? [];
  const selectedCount = tools.filter(
    (tool) => !tool.unavailableReason && selected.includes(tool.identity)
  ).length;
  /**
   * Selects button content in the existing condition order.
   */
  function renderButtonContent() {
    if (authorizing) {
      return t('schedules.authorization.authorizing', 'Authorizing…');
    } else if (selectedCount === 0) {
      return t(
        'schedules.authorization.confirmNoTools',
        'Confirm persistent authorization (no tools allowed)'
      );
    } else {
      return t(
        'schedules.authorization.confirmWithTools',
        'Confirm persistent authorization ({{count}} tools)',
        {
          count: selectedCount,
        }
      );
    }
  }
  return (
    <>
      {!defaultOpen && (
        <Button
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => {
            setSelected(null);
            setReviewRevision(task.revision);
            mutation.reset();
            setOpen(true);
          }}
        >
          <UserShieldIcon />
          {t('schedules.authorization.reviewButton', 'Review & authorize')}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!mutation.isPending) {
            setOpen(nextOpen);
            if (!nextOpen) {
              onClose?.();
            }
          }
        }}
      >
        <ScheduleDialogContent className="sm:max-w-2xl" showCloseButton={!mutation.isPending}>
          <DialogHeader>
            <DialogTitle>
              {t('schedules.authorization.dialogTitle', 'Authorize task: {{name}}', { name: task.name })}
            </DialogTitle>
            <DialogDescription>
              {t(
                'schedules.authorization.dialogDescription',
                'Authorization applies only to this task and stays valid until revoked or the run content changes; authorizing does not re-run past runs.'
              )}
            </DialogDescription>
          </DialogHeader>
          <ScheduleDialogBody>
            <Collapsible>
              <CollapsibleTrigger
                render={<Button variant="outline" size="sm" className="absolute top-1 right-3" />}
              >
                {t('schedules.authorization.viewRunContent', 'View run content')}
                <ChevronDownIcon data-icon="inline-end" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="mt-10 whitespace-pre-wrap wrap-break-word text-xs bg-muted text-muted-foreground p-4 rounded-lg">
                  {task.prompt}
                </p>
              </CollapsibleContent>
            </Collapsible>
            {preview.isFetching && (
              <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner />
                {t('schedules.authorization.checkingTools', 'Checking workspace tools…')}
              </p>
            )}
            {(preview.error || mutation.error) && (
              <p role="alert" className="text-sm text-destructive">
                {(mutation.error ?? preview.error)?.message}
              </p>
            )}
            {reviewRevision !== task.revision && (
              <p role="alert" className="text-yellow-500 text-sm">
                {t(
                  'schedules.authorization.revisionChanged',
                  'The task has changed. Close and review it again before confirming authorization.'
                )}
              </p>
            )}
            {preview.data && (
              <>
                <p className="break-all text-xs text-muted-foreground -mt-1 mb-2">
                  {t('schedules.authorization.workingDirectory', 'Working directory: {{cwd}}', {
                    cwd: preview.data.cwd,
                  })}
                </p>
                <ScheduleToolPicker
                  tools={tools}
                  selected={selected}
                  disabled={mutation.isPending || preview.isFetching}
                  onChange={setSelected}
                />
              </>
            )}
          </ScheduleDialogBody>
          <DialogFooter>
            {preview.data && (
              <Button
                disabled={
                  mutation.isPending ||
                  preview.isFetching ||
                  preview.isError ||
                  preview.data.taskRevision !== task.revision ||
                  reviewRevision !== task.revision
                }
                onClick={() => mutation.mutate({ revoke: false, key: crypto.randomUUID() })}
              >
                {authorizing && <Spinner data-icon="inline-start" aria-hidden="true" />}
                {renderButtonContent()}
              </Button>
            )}
            {task.authorizationRef && (
              <Button
                variant="destructive"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ revoke: true, key: crypto.randomUUID() })}
              >
                {revoking && <Spinner data-icon="inline-start" aria-hidden="true" />}
                {revoking
                  ? t('schedules.authorization.revoking', 'Revoking…')
                  : t('schedules.authorization.revoke', 'Revoke authorization for this task')}
              </Button>
            )}
          </DialogFooter>
        </ScheduleDialogContent>
      </Dialog>
    </>
  );
}
