/**
 * @author Codex
 * @description Composes the existing accessible Select for scheduler option fields.
 */
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Keeps field labels, disabled state and option values consistent across the scheduler forms.
 */
export function ScheduleSelect({
  id,
  value,
  items,
  onChange,
  disabled = false,
}: {
  id: string;
  value: string;
  items: { value: string; label: string }[];
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Select
      items={items}
      value={value || null}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next);
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={t('schedules.select.placeholder', 'Select')} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
