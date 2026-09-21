/**
 * @author Codex
 * @description Manages every Workspace schedule and its durable execution history from the Workbench.
 */
import { useState } from 'react';
import { Page } from '@/components/Page';
import { PageHero } from '@/components/PageHero';
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { Empty, EmptyHeader, EmptyDescription } from '@octopus/ui/components/empty';
import { SearchInput } from '@/components/SearchInput';
import { ListTodoIcon, RotateCcwClockIcon, RotateCwIcon } from 'lucide-react';
import { Tabs } from '@octopus/ui/components/tabs';
import { PageTabList } from '@/components/PageTabList';
import { ScheduleHistoryList } from './ScheduleHistoryList';
import { ScheduleDateRangePicker } from './ScheduleDateRangePicker';
import { getScheduleHistoryStatuses } from './schedule-history-status';
import { historyDateBounds } from './schedule-date-range';
import { Field, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@octopus/ui/components/dialog';
import {
  getScheduledRuns,
  getSchedulerServiceStatus,
  getSchedulerSettings,
  mutateScheduledTask,
} from '@/api/scheduled-tasks';
import { useWorkspaces } from '@/queries/workbench-queries';
import { ApiRequestError } from '@/utils/request';
import { useI18n } from '@/i18n/use-i18n';
import { workspaceDisplayName } from '@/utils/workspace';
import { ScheduleSelect } from './ScheduleSelect';
import { ScheduleDialogContent } from './ScheduleDialog';
import { ScheduleForm } from './ScheduleForm';
import { ScheduleRunHistoryDialog } from './ScheduleRunHistory';
import { ScheduleTaskList } from './ScheduleTaskList';
import { ScheduleAuthorizationRequest } from './ScheduleAuthorizationRequest';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { cn } from '@octopus/ui/lib/utils';
import type { DateRange } from 'react-day-picker';
import type {
  ScheduledHistoryQuery,
  ScheduledTask,
  ScheduledTaskPatch,
  ScheduledTaskQuery,
} from '@octopus/shared/protocol/scheduled-tasks';
import type { ScheduleMutationInput } from '@/api/scheduled-tasks';

interface ScheduleSelection {
  workspaceId: string;
  taskId: string;
}

interface ScheduleEditor {
  workspaceId: string;
  task: ScheduledTask;
}

/**
 * Uses server-owned query state and stable mutation identities across automatic transport retries.
 */
export function SchedulesPage({
  view,
  onViewChange,
  authorizationTarget,
  onAuthorizationClose,
}: {
  view: 'tasks' | 'history';
  authorizationTarget?: ScheduleSelection;
  /**
   * Removes the authorization deep link when its dialog closes.
   */
  onAuthorizationClose(): void;
  /**
   * Navigates to the selected tab while preserving the Workbench search state.
   */
  onViewChange(view: 'tasks' | 'history'): void;
}) {
  const workspaces = useWorkspaces();
  const { t } = useI18n();
  const [chosenWorkspace, setWorkspace] = useState('');
  const workspaceId = chosenWorkspace || workspaces.data?.[0]?.id || '';
  const [selected, setSelected] = useState<ScheduleSelection>();
  const [taskStatus, setTaskStatus] = useState<ScheduledTaskQuery['status']>('all');
  const [taskSearch, setTaskSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyRange, setHistoryRange] = useState<DateRange>();
  const [appliedHistoryRange, setAppliedHistoryRange] = useState<DateRange>();
  const invalidRange = Boolean(historyRange && (!historyRange.from || !historyRange.to));
  const historyFilters: Partial<ScheduledHistoryQuery> = {
    q: historySearch.trim(),
    ...(historyStatus !== 'all' ? { status: historyStatus as ScheduledHistoryQuery['status'] } : {}),
    ...historyDateBounds(t, appliedHistoryRange),
  };
  const [editor, setEditor] = useState<ScheduleEditor>();
  const queryClient = useQueryClient();
  const taskFetches = useIsFetching({ queryKey: ['scheduled-tasks'] });
  const schedulerService = useQuery({
    queryKey: ['scheduler-service'],
    queryFn: ({ signal }) => getSchedulerServiceStatus(signal),
  });
  const taskControlReady = schedulerService.data?.state === 'control-ready';
  const schedulerSettings = useQuery({
    queryKey: ['scheduler-settings'],
    queryFn: ({ signal }) => getSchedulerSettings(signal),
  });
  const runs = useQuery({
    queryKey: ['scheduled-tasks', selected?.workspaceId, 'runs', selected?.taskId],
    queryFn: ({ signal }) => getScheduledRuns(selected!.workspaceId, selected!.taskId, signal, { limit: 20 }),
    enabled: selected !== undefined,
  });
  const mutation = useMutation({
    mutationFn: ({ workspaceId, input }: { workspaceId: string; input: ScheduleMutationInput }) =>
      mutateScheduledTask(workspaceId, input),
    retry: (count, error) => count < 1 && error instanceof ApiRequestError && error.retryable,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] });
    },
  });
  /**
   * Allocates an identity once per user intent, before Query can retry the request.
   */
  function act(targetWorkspaceId: string, input: Omit<ScheduleMutationInput, 'key'>): void {
    mutation.mutate({
      workspaceId: targetWorkspaceId,
      input: { ...input, key: crypto.randomUUID() },
    });
  }
  const workspaceFilter = (
    <Field className="min-w-0 lg:w-44 lg:shrink-0">
      <FieldLabel htmlFor="schedule-workspace">{t('schedules.page.workspace', 'Workspace')}</FieldLabel>
      <ScheduleSelect
        id="schedule-workspace"
        disabled={mutation.isPending}
        value={chosenWorkspace || '__all__'}
        items={[
          { value: '__all__', label: t('schedules.page.allWorkspaces', 'All workspaces') },
          ...(workspaces.data ?? []).map((workspace) => ({
            value: workspace.id,
            label: workspaceDisplayName(t, workspace),
          })),
        ]}
        onChange={(value) => {
          setWorkspace(value === '__all__' ? '' : value);
          setSelected(undefined);
          setEditor(undefined);
          mutation.reset();
        }}
      />
    </Field>
  );
  return (
    <Page classNames={{ container: 'overflow-hidden' }}>
      {authorizationTarget && (
        <ScheduleAuthorizationRequest
          key={`${authorizationTarget.workspaceId}:${authorizationTarget.taskId}`}
          {...authorizationTarget}
          onClose={onAuthorizationClose}
        />
      )}
      <div aria-label="freeze-header" className="shrink-0 flex flex-col gap-4">
        <PageHero
          title={t('schedules.page.title', 'Scheduled tasks')}
          description={t(
            'schedules.page.description',
            'Manage scheduled tasks across all workspaces. Each task runs in an isolated session, and the completion summary is echoed back to the source session.'
          )}
          extra={
            <Button
              variant="outline"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] })}
              aria-label="Refresh"
              aria-busy={taskFetches > 0}
              disabled={!taskControlReady || !workspaceId || taskFetches > 0}
            >
              <RotateCwIcon
                aria-hidden="true"
                data-icon="inline-start"
                className={cn(taskFetches > 0 && 'animate-spin')}
              />
              {t('common.refresh', 'Refresh')}
            </Button>
          }
        />
        <Tabs
          value={view}
          onValueChange={(value) => {
            if (value === 'tasks' || value === 'history') {
              onViewChange(value);
            }
          }}
        >
          <PageTabList
            items={[
              { value: 'tasks', label: t('schedules.page.tabTasks', 'Task management'), icon: ListTodoIcon },
              {
                value: 'history',
                label: t('schedules.page.tabHistory', 'Run history'),
                icon: RotateCcwClockIcon,
              },
            ]}
          />
        </Tabs>
        {view === 'tasks' && (
          <div aria-label="condition" className="shrink-0">
            <FieldGroup className="flex flex-col gap-3 lg:flex-row lg:items-end">
              {workspaceFilter}
              <Field className="min-w-0 lg:w-48 lg:shrink-0">
                <FieldLabel htmlFor="task-state-filter">
                  {t('schedules.page.taskStatus', 'Task status')}
                </FieldLabel>
                <ScheduleSelect
                  id="task-state-filter"
                  value={taskStatus}
                  items={[
                    { value: 'all', label: t('schedules.page.statusAll', 'All unarchived tasks') },
                    { value: 'pending', label: t('schedules.page.statusPending', 'Pending') },
                    { value: 'completed', label: t('schedules.page.statusCompleted', 'Completed') },
                    { value: 'paused', label: t('schedules.page.statusPaused', 'Paused') },
                    { value: 'attention', label: t('schedules.page.statusAttention', 'Needs attention') },
                    { value: 'archived', label: t('schedules.page.statusArchived', 'Archived') },
                  ]}
                  onChange={(value) => setTaskStatus(value as ScheduledTaskQuery['status'])}
                />
              </Field>
              <Field className="min-w-0 lg:w-60 lg:shrink-0">
                <FieldLabel htmlFor="task-name-filter">
                  {t('schedules.page.searchTasks', 'Search tasks')}
                </FieldLabel>
                <SearchInput
                  id="task-name-filter"
                  aria-label="Search tasks"
                  className="w-full"
                  maxLength={200}
                  placeholder={t('schedules.page.searchTasksPlaceholder', 'Search task names')}
                  value={taskSearch}
                  onChange={(event) => setTaskSearch(event.target.value)}
                />
              </Field>
            </FieldGroup>
          </div>
        )}
        {view === 'history' && (
          <div aria-label="condition" className="shrink-0">
            <FieldGroup className="flex flex-col gap-3 lg:flex-row lg:items-end">
              {workspaceFilter}
              <Field className="lg:w-36 lg:shrink-0">
                <FieldLabel htmlFor="history-status">
                  {t('schedules.page.historyResult', 'Run result')}
                </FieldLabel>
                <ScheduleSelect
                  id="history-status"
                  value={historyStatus}
                  items={getScheduleHistoryStatuses(t)}
                  onChange={setHistoryStatus}
                />
              </Field>
              <Field className="lg:w-auto lg:shrink-0">
                <FieldLabel htmlFor="history-date-range">
                  {t('schedules.page.historyDateRange', 'Run date range')}
                </FieldLabel>
                <ScheduleDateRangePicker
                  value={historyRange}
                  onChange={(range) => {
                    setHistoryRange(range);
                    if (!range || (range.from && range.to)) {
                      setAppliedHistoryRange(range);
                    }
                  }}
                />
              </Field>
              <Field className="min-w-0 lg:w-60 lg:shrink-0">
                <FieldLabel htmlFor="history-search">
                  {t('schedules.page.searchTasks', 'Search tasks')}
                </FieldLabel>
                <SearchInput
                  id="history-search"
                  value={historySearch}
                  maxLength={200}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder={t('schedules.page.searchHistoryPlaceholder', 'Search all run records')}
                />
              </Field>
            </FieldGroup>
            {invalidRange && (
              <p role="alert" className="text-sm text-destructive">
                {t('schedules.page.invalidRange', 'Select an end date to complete the date range.')}
              </p>
            )}
          </div>
        )}
      </div>
      <ScrollArea aria-label="content" className="min-h-0 flex-1 overflow-hidden">
        <div className="flex flex-col gap-4 px-1 pb-5">
          {(workspaces.error || mutation.error) && (
            <p role="alert" className="text-sm text-destructive">
              {(mutation.error ?? workspaces.error)?.message}
            </p>
          )}
          {workspaces.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('schedules.page.loadingWorkspaces', 'Loading workspaces…')}
            </p>
          )}
          {!workspaces.isPending && !workspaceId && (
            <p className="text-sm text-muted-foreground">
              {t('schedules.page.noWorkspace', 'Create a workspace and a session first.')}
            </p>
          )}
          {view === 'tasks' && (
            <p className="text-sm text-muted-foreground">
              {t(
                'schedules.page.archiveNote',
                'Archiving stops future runs and requests cancellation of the active run; run history and the authorization audit are kept.'
              )}
            </p>
          )}
          {taskControlReady && view === 'tasks' && (
            <ScheduleTaskList
              key={`${chosenWorkspace}:${taskStatus}:${taskSearch}`}
              workspaces={workspaces.data ?? []}
              workspaceId={chosenWorkspace}
              status={taskStatus}
              search={taskSearch.trim()}
              selectedTaskId={selected?.taskId}
              mutating={mutation.isPending}
              onAction={act}
              onEdit={(targetWorkspaceId, task) => {
                mutation.reset();
                setEditor({ workspaceId: targetWorkspaceId, task });
              }}
              onSelectHistory={(targetWorkspaceId, taskId) => {
                setSelected({ workspaceId: targetWorkspaceId, taskId });
              }}
            />
          )}
          {taskControlReady && view === 'history' && workspaceId && (
            <ScheduleHistoryList
              key={JSON.stringify([chosenWorkspace, historyFilters])}
              workspaceId={chosenWorkspace}
              filters={historyFilters}
            />
          )}
          {!taskControlReady && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyDescription>
                  {t(
                    'schedules.page.serviceStopped',
                    'The scheduler service is stopped. Start it in Settings under "Scheduler".'
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </ScrollArea>
      {view === 'tasks' && selected && (
        <ScheduleRunHistoryDialog
          key={`${selected.workspaceId}:${selected.taskId}`}
          workspaceId={selected.workspaceId}
          taskId={selected.taskId}
          items={runs.data?.items}
          error={runs.error}
          pending={runs.isPending}
          mutating={mutation.isPending}
          onClose={() => setSelected(undefined)}
          onCancel={(runId) =>
            act(selected.workspaceId, {
              operation: 'cancel',
              taskId: selected.taskId,
              input: { runId },
            })
          }
        />
      )}
      {view === 'tasks' && (
        <Dialog
          open={editor !== undefined}
          onOpenChange={(open) => {
            if (!open) {
              setEditor(undefined);
            }
          }}
        >
          <ScheduleDialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{t('schedules.page.editTitle', 'Edit scheduled task')}</DialogTitle>
              <DialogDescription>
                {t(
                  'schedules.page.editDescription',
                  'Set the run time, session, and prompt. A saved task runs only after explicit authorization. Changing the run content requires re-authorization; archiving keeps the history and requests cancellation of the active run.'
                )}
              </DialogDescription>
            </DialogHeader>
            {editor && (
              <ScheduleForm
                key={`${editor.task.id}:${editor.task.revision}`}
                task={editor.task}
                pending={mutation.isPending}
                defaultTimezone={schedulerSettings.data?.timezone}
                onClose={() => setEditor(undefined)}
                onSave={async (input) => {
                  const patch: ScheduledTaskPatch = { ...input };
                  delete patch.enabled;
                  if (JSON.stringify(editor.task.schedule) === JSON.stringify(input.schedule)) {
                    delete patch.schedule;
                  }
                  await mutation.mutateAsync({
                    workspaceId: editor.workspaceId,
                    input: {
                      key: crypto.randomUUID(),
                      operation: 'update',
                      taskId: editor.task.id,
                      revision: editor.task.revision,
                      input: patch,
                    },
                  });
                  setEditor(undefined);
                }}
              />
            )}
          </ScheduleDialogContent>
        </Dialog>
      )}
    </Page>
  );
}
