/**
 * @author Codex
 * @description Presents collapsed execution records with aligned actions and Markdown results.
 */
import { formatDateTime } from '@/utils/date';
import { Clock3Icon } from 'lucide-react';
import { TimelineItem } from '@/components/Timeline';
import { ScheduleRunStatusBadge } from './ScheduleRunStatusBadge';
import { ScheduleRunDetails } from './ScheduleRunDetails';
import { scheduleRunStatusLabel } from '@/features/schedules/utils/schedule-history-status';
import { useI18n } from '@/i18n/use-i18n';
import type { ScheduleRunDetailsProps } from './ScheduleRunDetails';

/**
 * Wraps shared run details in the task history timeline presentation.
 */
export function ScheduleHistoryCard(props: ScheduleRunDetailsProps) {
  const { run } = props;
  const { t } = useI18n();
  return (
    <TimelineItem
      icon={<Clock3Icon />}
      title={<time dateTime={run.scheduledFor}>{formatDateTime(run.scheduledFor)}</time>}
    >
      <div className="flex min-w-0 flex-col gap-4 rounded-xl border p-4 text-sm">
        <div className="flex flex-col gap-2">
          {run.taskName && (
            <h3 className="wrap-anywhere font-medium">
              {run.taskName}
              {run.archived ? t('schedules.history.archivedSuffix', ' (archived)') : ''}
            </h3>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ScheduleRunStatusBadge status={run.status} label={scheduleRunStatusLabel(t, run.status)} />
          </div>
        </div>
        <ScheduleRunDetails {...props} />
      </div>
    </TimelineItem>
  );
}
