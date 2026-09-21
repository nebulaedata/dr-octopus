/**
 * @author Codex
 * @description Loads and displays a scoped read-only run transcript.
 */
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useQuery } from '@tanstack/react-query';
import { getScheduledTranscript } from '@/api/scheduled-tasks';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Mount only for an expanded run so closed panels do not request execution artifacts.
 */
export function ScheduleTranscript({
  id,
  workspaceId,
  taskId,
  runId,
}: {
  id: string;
  workspaceId: string;
  taskId: string;
  runId: string;
}) {
  const query = useQuery({
    queryKey: ['schedule-transcript', workspaceId, taskId, runId],
    queryFn: ({ signal }) => getScheduledTranscript(workspaceId, taskId, runId, signal),
  });
  const { t } = useI18n();
  return (
    <div id={id} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">
        {t('schedules.transcript.readonlyNote', 'Read-only record. Viewing details does not re-run the task.')}
      </p>
      {query.isPending && <p role="status">{t('schedules.transcript.loading', 'Loading…')}</p>}
      {query.error && (
        <p role="alert" className="text-destructive">
          {query.error.message}
        </p>
      )}
      {query.data?.entries.length === 0 && (
        <p>{t('schedules.transcript.empty', 'This run has not produced any records yet.')}</p>
      )}
      {query.data?.truncated && (
        <p>{t('schedules.transcript.truncated', 'Only the most recent records are shown.')}</p>
      )}
      {query.data?.entries.map((entry, index) => (
        <article key={index} className="border-b py-3 last:border-0">
          <p className="text-xs font-medium text-muted-foreground">{entry.role}</p>
          <MarkdownRenderer className="mt-2 min-w-0 overflow-hidden text-sm! wrap-anywhere [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
            {entry.text}
          </MarkdownRenderer>
        </article>
      ))}
    </div>
  );
}
