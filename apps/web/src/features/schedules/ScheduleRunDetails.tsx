/**
 * @author Codex
 * @description Shares single-run navigation, summary and transcript panels across schedule history views.
 */
import { useId } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ScheduleTranscript } from './ScheduleTranscript';
import { RunResultLink } from './RunResultLink';
import { useI18n } from '@/i18n/use-i18n';
import type { ReactNode } from 'react';
import type { ScheduledHistoryRun } from '@octopus/shared/protocol/scheduled-tasks';

export interface ScheduleRunDetailsProps {
  run: ScheduledHistoryRun;
  workspaceId: string;
  mutating?: boolean;
  /**
   * Optional run metadata shown beside the actions, stacking above them on narrow screens.
   */
  header?: ReactNode;
  expandedPanel: 'summary' | 'transcript' | null;
  /**
   * Selects the visible result panel, or closes it.
   */
  onExpandedChange(panel: 'summary' | 'transcript' | null): void;
  /**
   * Requests cancellation of this execution only when the owner supports it.
   */
  onCancel?(runId: string): void;
}

/**
 * Shares run actions and lazily mounted result panels between history rows and timeline cards.
 */
export function ScheduleRunDetails({
  run,
  workspaceId,
  mutating = false,
  header,
  onCancel,
  expandedPanel,
  onExpandedChange,
}: ScheduleRunDetailsProps) {
  const summaryOpen = expandedPanel === 'summary';
  const { t } = useI18n();
  const transcriptOpen = expandedPanel === 'transcript';
  const summaryId = useId();
  const transcriptId = useId();
  return (
    <>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {header}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {run.settledAt && <RunResultLink workspaceId={workspaceId} taskId={run.taskId} runId={run.id} />}
          {run.summary && (
            <Button
              size="sm"
              variant="outline"
              aria-expanded={summaryOpen}
              aria-controls={summaryOpen ? summaryId : undefined}
              onClick={() => onExpandedChange(summaryOpen ? null : 'summary')}
            >
              {t('schedules.runDetails.summary', 'Result summary')}
              <ChevronDownIcon
                aria-hidden="true"
                data-icon="inline-end"
                className={summaryOpen ? 'rotate-180' : undefined}
              />
            </Button>
          )}
          {onCancel &&
            !run.archived &&
            ['queued', 'claimed', 'dispatching', 'running'].includes(run.status) && (
              <Button size="sm" variant="destructive" disabled={mutating} onClick={() => onCancel(run.id)}>
                {t('schedules.runDetails.cancelRun', 'Cancel this run')}
              </Button>
            )}
          <Button
            size="sm"
            variant="outline"
            aria-expanded={transcriptOpen}
            aria-controls={transcriptOpen ? transcriptId : undefined}
            onClick={() => onExpandedChange(transcriptOpen ? null : 'transcript')}
          >
            {t('schedules.runDetails.transcript', 'Run details')}
            <ChevronDownIcon
              aria-hidden="true"
              data-icon="inline-end"
              className={transcriptOpen ? 'rotate-180' : undefined}
            />
          </Button>
        </div>
      </div>
      {summaryOpen && run.summary ? (
        <div id={summaryId}>
          <MarkdownRenderer className="min-w-0 overflow-hidden rounded-lg border p-3 text-sm! wrap-anywhere sm:p-4 [&_h1]:text-xl! [&_h2]:text-lg! [&_h3]:text-base! [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
            {run.summary}
          </MarkdownRenderer>
        </div>
      ) : null}
      {transcriptOpen ? (
        <ScheduleTranscript id={transcriptId} workspaceId={workspaceId} taskId={run.taskId} runId={run.id} />
      ) : null}
      {run.errorCode && (
        <p role="alert" className="wrap-anywhere text-xs text-destructive">
          {run.errorCode}
        </p>
      )}
    </>
  );
}
