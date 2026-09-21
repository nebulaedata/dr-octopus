/**
 * @author Codex
 * @description Shares localized execution-result labels between history filters and list rows.
 */
import type { Translate } from '@/i18n/use-i18n';

/**
 * Localizes one scheduler run status while preserving every lifecycle phase.
 */
export function scheduleRunStatusLabel(t: Translate, status: string): string {
  return (
    {
      succeeded: t('schedules.runStatus.succeeded', 'Succeeded'),
      failed: t('schedules.runStatus.failed', 'Failed'),
      needs_attention: t('schedules.runStatus.needsAttention', 'Needs attention'),
      timed_out: t('schedules.runStatus.timedOut', 'Timed out'),
      cancelled: t('schedules.runStatus.cancelled', 'Cancelled'),
      interrupted: t('schedules.runStatus.interrupted', 'Interrupted'),
      skipped: t('schedules.runStatus.skipped', 'Skipped'),
      queued: t('schedules.runStatus.queued', 'Queued'),
      claimed: t('schedules.runStatus.claimed', 'Claimed'),
      dispatching: t('schedules.runStatus.dispatching', 'Dispatching'),
      running: t('schedules.runStatus.running', 'Running'),
    }[status] ?? status
  );
}

/**
 * Builds the localized history-filter options, leading with the unfiltered choice.
 */
export function getScheduleHistoryStatuses(t: Translate): { value: string; label: string }[] {
  return [
    { value: 'all', label: t('schedules.runStatus.all', 'All results') },
    { value: 'succeeded', label: t('schedules.runStatus.succeeded', 'Succeeded') },
    { value: 'failed', label: t('schedules.runStatus.failed', 'Failed') },
    { value: 'needs_attention', label: t('schedules.runStatus.needsAttention', 'Needs attention') },
    { value: 'timed_out', label: t('schedules.runStatus.timedOut', 'Timed out') },
    { value: 'cancelled', label: t('schedules.runStatus.cancelled', 'Cancelled') },
    { value: 'interrupted', label: t('schedules.runStatus.interrupted', 'Interrupted') },
    { value: 'skipped', label: t('schedules.runStatus.skipped', 'Skipped') },
    { value: 'queued', label: t('schedules.runStatus.queued', 'Queued') },
    { value: 'claimed', label: t('schedules.runStatus.claimed', 'Claimed') },
    { value: 'dispatching', label: t('schedules.runStatus.dispatching', 'Dispatching') },
    { value: 'running', label: t('schedules.runStatus.running', 'Running') },
  ];
}
