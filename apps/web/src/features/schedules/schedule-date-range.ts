/**
 * @author Codex
 * @description Converts calendar ranges into inclusive local-day history query boundaries.
 */
import type { DateRange } from 'react-day-picker';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Include both selected calendar days, accounting for local timezone and daylight saving changes.
 */
export function historyDateBounds(t: Translate, range: DateRange | undefined): { from?: string; to?: string } {
  if (!range) {
    return {};
  }
  if (!range.from || !range.to) {
    throw new Error(t('schedules.dateRange.incomplete', 'Select a complete date range.'));
  }
  const from = new Date(range.from);
  const to = new Date(range.to);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
    throw new Error(t('schedules.dateRange.invalid', 'The date range is invalid.'));
  }
  return { from: from.toISOString(), to: to.toISOString() };
}
