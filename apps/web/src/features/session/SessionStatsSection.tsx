/**
 * @author Codex
 * @description Presents cumulative Pi usage inside the Session Properties Panel.
 */
import { useQuery } from '@tanstack/react-query';
import { Button } from '@octopus/ui/components/button';
import { getSessionStats } from '@/api/session-stats';
import { useI18n } from '@/i18n/use-i18n';
import type { SessionDto } from '@octopus/shared/protocol';

/**
 * Refreshes cumulative totals while mounted in the visible Properties Panel.
 */
export function SessionStatsSection({ session }: { session: SessionDto }) {
  const { t } = useI18n();
  const stats = useQuery({
    queryKey: ['session-stats', session.workspaceId, session.id],
    queryFn: ({ signal }) => getSessionStats(session.workspaceId, session.id, signal),
    staleTime: 0,
    refetchInterval: 5_000,
    retry: false,
  });
  const data = stats.data;
  const rows: [string, string][] =
    data === undefined
      ? []
      : [
          [
            t('session.stats.inputTokens', 'Input tokens'),
            (data.tokens.input + data.tokens.cacheRead + data.tokens.cacheWrite).toLocaleString('en'),
          ],
          [t('session.stats.outputTokens', 'Output tokens'), data.tokens.output.toLocaleString('en')],
          [t('session.stats.totalTokens', 'Total tokens'), data.tokens.total.toLocaleString('en')],
          [t('session.stats.cacheRead', 'Cache read'), data.tokens.cacheRead.toLocaleString('en')],
          [t('session.stats.cacheWrite', 'Cache write'), data.tokens.cacheWrite.toLocaleString('en')],
          [t('session.stats.estimatedCost', 'Estimated cost'), `$${data.cost.toFixed(3)}`],
          [t('session.stats.totalMessages', 'Total messages'), data.totalMessages.toLocaleString('en')],
          [
            t('session.stats.userAssistantMessages', 'User / assistant messages'),
            `${data.userMessages.toLocaleString('en')} / ${data.assistantMessages.toLocaleString('en')}`,
          ],
          [
            t('session.stats.toolCallsResults', 'Tool calls / results'),
            `${data.toolCalls.toLocaleString('en')} / ${data.toolResults.toLocaleString('en')}`,
          ],
        ];
  return (
    <section
      aria-label="Session usage"
      className="flex flex-col gap-3.5 px-0.5 py-4.5"
    >
      <h3 className="text-sm font-semibold">{t('session.stats.title', 'Session usage')}</h3>
      <p className="text-xs text-muted-foreground">
        {t('session.stats.description', 'Cumulative Session statistics, including compacted history.')}
      </p>
      {stats.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('session.stats.loading', 'Loading statistics…')}
        </p>
      )}
      {stats.isError && (
        <div role="alert" className="flex flex-col gap-2 text-sm">
          <p>
            {t('session.stats.loadFailedPrefix', 'Failed to load statistics: ')}
            {stats.error.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => void stats.refetch()}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      )}
      {data !== undefined && (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-3.5 text-xs tabular-nums">
          {rows.map(([label, value]) => (
            <StatRow key={label} label={label} value={value} />
          ))}
        </dl>
      )}
    </section>
  );
}

/**
 * Keeps a statistic label and its exact value aligned in the shared definition grid.
 */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium font-geist text-muted-foreground">{value}</dd>
    </>
  );
}
