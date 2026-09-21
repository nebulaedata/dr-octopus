/**
 * @author Codex
 * @description Displays immutable task results with a persistent prompt and paginated execution timeline.
 */
import { formatDateTime } from '@/utils/date';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ScheduleRunStatusBadge } from '../schedules/ScheduleRunStatusBadge';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ClockIcon, HistoryIcon, AlertCircleIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { ListPagination } from '@/components/ListPagination';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Separator } from '@octopus/ui/components/separator';
import { getExecutionSession } from '@/api/notifications';
import { useI18n } from '@/i18n/use-i18n';
import { SessionReadReceipt } from './SessionReadReceipt';
import { ExecutionTimeline } from './ExecutionTimeline';
import type { SessionDto } from '@octopus/shared/protocol';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Localizes the execution run status machine with a generic result fallback.
 */
function executionStatusLabel(t: Translate, status: string): string {
  return (
    {
      queued: t('session.execution.status.queued', 'Queued'),
      running: t('session.execution.status.running', 'Running'),
      succeeded: t('session.execution.status.succeeded', 'Succeeded'),
      failed: t('session.execution.status.failed', 'Failed'),
      needs_attention: t('session.execution.status.needsAttention', 'Needs attention'),
      timed_out: t('session.execution.status.timedOut', 'Timed out'),
      cancelled: t('session.execution.status.cancelled', 'Cancelled'),
      interrupted: t('session.execution.status.interrupted', 'Interrupted'),
      skipped: t('session.execution.status.skipped', 'Skipped'),
    }[status] ?? t('session.execution.status.fallback', 'Execution result')
  );
}

/**
 * Reset pagination and disclosure state when navigating to another result Session.
 */
export function ExecutionSession({ session }: { session: SessionDto }) {
  return <ExecutionSessionContent key={session.id} session={session} />;
}

/**
 * Keep run context visible while reading older pages without starting a runtime.
 */
function ExecutionSessionContent({ session }: { session: SessionDto }) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['execution-session', session.id, offset],
    queryFn: ({ signal }) => getExecutionSession(session.workspaceId, session.id, offset, signal),
  });
  const run = query.data?.run;
  const status = run?.status ?? session.execution?.status ?? '';
  const failed = ['failed', 'needs_attention', 'timed_out', 'interrupted'].includes(status);
  return (
    <section aria-label="Task execution result" className="h-full min-h-0 overflow-y-auto">
      <SessionReadReceipt session={session} ready={query.isSuccess} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">
                {t('layout.session.taskResult', 'Task result')}
              </h1>
              <ScheduleRunStatusBadge status={status} label={executionStatusLabel(t, status)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('session.execution.readonlyNote', 'Read-only record · viewing does not re-run the task')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/schedules" search={{ tab: 'history' }} />}
          >
            <HistoryIcon data-icon="inline-start" />
            {t('session.execution.history', 'Run history')}
          </Button>
        </header>
        {query.isPending && (
          <div
            role="status"
            aria-label="Loading execution result"
            className="flex flex-col gap-4"
          >
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {query.error && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>{t('session.execution.loadFailedTitle', 'Failed to load execution record')}</AlertTitle>
            <AlertDescription>
              <p>{query.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {query.data && run && (
          <>
            {(run.summary || run.errorCode) && (
              <Alert variant={failed ? 'destructive' : 'default'}>
                <AlertCircleIcon />
                <AlertTitle>
                  {failed
                    ? t('session.execution.attentionTitle', 'This run needs attention')
                    : t('session.execution.summaryTitle', 'Run summary')}
                </AlertTitle>
                <AlertDescription className="mt-2">
                  {run.summary && (
                    <MarkdownRenderer className="min-w-0 max-w-full overflow-hidden text-sm! wrap-anywhere [&_h1]:text-xl! [&_h2]:text-lg! [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
                      {run.summary}
                    </MarkdownRenderer>
                  )}
                  {run.errorCode && <p className="break-all font-mono text-xs">{run.errorCode}</p>}
                </AlertDescription>
              </Alert>
            )}
            <Card size="sm">
              <CardHeader>
                <CardTitle>{t('session.execution.promptTitle', 'Task instructions')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap wrap-break-word text-sm leading-7">
                  {query.data.prompt || t('session.execution.promptMissing', 'No task instructions were kept')}
                </p>
              </CardContent>
            </Card>
            <section
              aria-label="Execution timeline"
              className="flex min-w-0 flex-col gap-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  {t('session.execution.timelineTitle', 'Execution timeline')}
                </h2>
                {run.startedAt && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ClockIcon aria-hidden="true" className="size-3.5" />
                    {t('session.execution.startedAt', 'Started at')}{' '}
                    <time dateTime={run.startedAt}>{formatDateTime(run.startedAt)}</time>
                  </span>
                )}
              </div>
              <ExecutionTimeline key={offset} items={query.data.items} prompt={query.data.prompt} />
            </section>
          </>
        )}
        {(offset > 0 || query.data?.hasMore) && (
          <>
            <Separator />
            <ListPagination
              aria-label="Execution record pagination"
              page={offset / 20 + 1}
              hasNextPage={Boolean(query.data?.hasMore)}
              disabled={query.isFetching}
              previousLabel={t('session.execution.newerRecords', 'Newer records')}
              nextLabel={t('session.execution.olderRecords', 'Older records')}
              onPageChange={(page) => setOffset((page - 1) * 20)}
            />
          </>
        )}
      </div>
    </section>
  );
}
