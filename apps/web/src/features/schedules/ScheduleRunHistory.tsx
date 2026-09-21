/**
 * @author Codex
 * @description Displays bounded run history and explicit cancellation of queued work.
 */
import { useState } from 'react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@octopus/ui/components/dialog';
import { ScheduleDialogContent, ScheduleDialogBody } from './ScheduleDialog';
import { ScheduleHistoryCard } from './ScheduleHistoryCard';
import { Timeline } from '@/components/Timeline';
import { useI18n } from '@/i18n/use-i18n';
import type { ScheduledHistoryRun } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Shows recent task runs or a selected execution with one expanded result panel.
 */
export function ScheduleRunHistoryDialog({
  workspaceId,
  taskId,
  items,
  error,
  pending,
  mutating,
  onClose,
  onCancel,
  mode = 'recent',
}: {
  workspaceId: string;
  taskId: string;
  items?: ScheduledHistoryRun[];
  mode?: 'recent' | 'detail';
  error: Error | null;
  pending: boolean;
  mutating: boolean;
  onClose(): void;
  onCancel?(runId: string): void;
}) {
  const [expanded, setExpanded] = useState<{
    runId: string;
    panel: 'summary' | 'transcript';
  }>();
  const { t } = useI18n();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ScheduleDialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'recent'
              ? t('schedules.runHistory.titleRecent', 'Recent run records')
              : t('schedules.runHistory.titleDetail', 'Run details')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'recent'
              ? t(
                  'schedules.runHistory.descriptionRecent',
                  'Shows only the 20 most recent runs, newest first. Expand the summary or run details to see results.'
                )
              : t(
                  'schedules.runHistory.descriptionDetail',
                  'Shows the selected run record; expand the summary or run details to see results.'
                )}
          </DialogDescription>
        </DialogHeader>
        <ScheduleDialogBody>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error.message}
            </p>
          )}
          {pending && <p role="status" className="mt-3 text-sm">{t('schedules.runHistory.loading', 'Loading records…')}</p>}
          {items?.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('schedules.runHistory.empty', 'No run records yet.')}
            </p>
          )}
          <Timeline>
            {items?.map((run) => (
              <ScheduleHistoryCard
                key={run.id}
                run={run.taskId ? run : { ...run, taskId }}
                workspaceId={workspaceId}
                mutating={mutating}
                onCancel={onCancel}
                expandedPanel={expanded?.runId === run.id ? expanded.panel : null}
                onExpandedChange={(panel) => setExpanded(panel ? { runId: run.id, panel } : undefined)}
              />
            ))}
          </Timeline>
        </ScheduleDialogBody>
      </ScheduleDialogContent>
    </Dialog>
  );
}
