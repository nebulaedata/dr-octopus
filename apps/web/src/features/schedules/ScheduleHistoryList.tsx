/**
 * @author Codex
 * @description Displays paginated execution history and read-only details for the current page filters.
 */
import { formatDateTime } from '@/utils/date';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchScheduledHistory } from '@/api/scheduled-tasks';
import { useWorkspaces } from '@/queries/workbench-queries';
import { workspaceDisplayName } from '@/utils/workspace';
import { SchedulePagination } from './SchedulePagination';
import { ScheduleRunDetails } from './ScheduleRunDetails';
import { scheduleRunStatusLabel } from '@/features/schedules/utils/schedule-history-status';
import { useI18n } from '@/i18n/use-i18n';
import type { ScheduledHistoryQuery } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Owns history loading, pagination and inline expansion; remount on filter changes to reset the page.
 */
export function ScheduleHistoryList({
  workspaceId,
  filters,
}: {
  workspaceId: string;
  filters: Partial<Pick<ScheduledHistoryQuery, 'q' | 'status' | 'from' | 'to'>>;
}) {
  const [offset, setOffset] = useState(0);
  const { t } = useI18n();
  const workspaces = useWorkspaces();
  const [expanded, setExpanded] = useState<{
    runId: string;
    panel: 'summary' | 'transcript';
  }>();
  const history = useQuery({
    queryKey: ['scheduled-tasks', workspaceId, 'history', filters, offset],
    queryFn: ({ signal }) => searchScheduledHistory(workspaceId, { ...filters, offset, limit: 21 }, signal),
  });
  return (
    <section aria-label="Workspace run history" className="flex flex-col gap-4">
      {history.error && (
        <p role="alert" className="text-sm text-destructive">
          {history.error.message}
        </p>
      )}
      {history.isPending && <p role="status">{t('schedules.history.loading', 'Loading history…')}</p>}
      {history.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('schedules.history.empty', 'No matching run records.')}
        </p>
      )}
      <ul className="divide-y rounded-lg border px-4">
        {history.data?.items.slice(0, 20).map((run) => (
          <li key={run.id} className="flex min-w-0 flex-col gap-3 py-4">
            <ScheduleRunDetails
              header={
                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <p className="text-sm wrap-break-word font-medium">
                    {run.taskName ?? run.taskId}
                    {run.archived ? t('schedules.history.archivedSuffix', ' (archived)') : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('schedules.history.workspacePrefix', 'Workspace: {{name}}', {
                      name: workspaceDisplayName(
                        t,
                        workspaces.data?.find((workspace) => workspace.id === run.workspaceId) ?? {
                          kind: 'project',
                          name: run.workspaceName,
                        }
                      ),
                    })}{' '}
                    · {scheduleRunStatusLabel(t, run.status)} · {formatDateTime(run.scheduledFor)} ·{' '}
                    {run.triggerSource === 'manual'
                      ? t('schedules.history.triggerManual', 'Manual run')
                      : t('schedules.history.triggerScheduled', 'Scheduled trigger')}
                  </p>
                </div>
              }
              run={run}
              workspaceId={run.workspaceId}
              expandedPanel={expanded?.runId === run.id ? expanded.panel : null}
              onExpandedChange={(panel) => setExpanded(panel ? { runId: run.id, panel } : undefined)}
            />
          </li>
        ))}
      </ul>
      <SchedulePagination
        offset={offset}
        pending={history.isFetching}
        hasMore={(history.data?.items.length ?? 0) > 20}
        onChange={(nextOffset) => {
          setOffset(nextOffset);
          setExpanded(undefined);
        }}
      />
    </section>
  );
}
