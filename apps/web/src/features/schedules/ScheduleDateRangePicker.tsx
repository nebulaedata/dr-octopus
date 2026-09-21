/**
 * @author Codex
 * @description Composes the shadcn Calendar and Popover into a local-date range filter.
 */
import { formatDateTime } from '@/utils/date';
import { CalendarIcon, ChevronDownIcon, XCircleIcon } from 'lucide-react';
import { Calendar } from '@octopus/ui/components/calendar';
import { Button } from '@octopus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@octopus/ui/components/popover';
import { zhCN } from 'react-day-picker/locale';
import { useI18n } from '@/i18n/use-i18n';
import type { DateRange } from 'react-day-picker';

/**
 * Leave partial selections visible until the user chooses the second day or clears the range.
 */
export function ScheduleDateRangePicker({
  value,
  onChange,
}: {
  value: DateRange | undefined;
  onChange(value: DateRange | undefined): void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              id="history-date-range"
              type="button"
              data-empty={!value}
              variant="outline"
              className="w-56 justify-between font-normal hover:bg-[unset] data-[empty=true]:text-muted-foreground"
            />
          }
        >
          <div className="flex items-center gap-1">
            <CalendarIcon data-icon="inline-start" className="text-muted-foreground" />
            {value?.from
              ? `${formatDateTime(value.from, 'YYYY-MM-DD')} — ${
                  value.to
                    ? formatDateTime(value.to, 'YYYY-MM-DD')
                    : t('schedules.dateRangePicker.pickEndDate', 'Pick an end date')
                }`
              : t('schedules.dateRangePicker.pickRange', 'Pick a date range')}
          </div>
          {value ? (
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => onChange(undefined)}>
              <XCircleIcon data-icon="inline-end" className="text-muted-foreground size-3.5" />
            </Button>
          ) : (
            <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-[min(32rem,80dvh)] w-auto overflow-y-auto p-0">
          <Calendar
            mode="range"
            selected={value}
            onSelect={onChange}
            defaultMonth={value?.from}
            numberOfMonths={2}
            locale={zhCN}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
