/**
 * @author Codex
 * @description Composes the shared shadcn Date Picker pattern and preserves calendar dates without UTC conversion.
 */
import { useState } from 'react';
import { zhCN } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Calendar } from '@octopus/ui/components/calendar';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@octopus/ui/components/popover';

/**
 * Keeps calendar visibility local while TanStack Form owns the submitted YYYY-MM-DD value.
 */
export function AgentDatePicker({
  id,
  label,
  value,
  disabled,
  invalid,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value + 'T00:00:00') : undefined;
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          onBlur();
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className="w-full justify-between font-normal"
            disabled={disabled}
            aria-label={label}
            aria-invalid={invalid}
          />
        }
      >
        <span className={value ? undefined : 'text-muted-foreground'}>{value || '选择日期'}</span>
        <CalendarIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-0">
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <Calendar
          mode="single"
          locale={zhCN}
          selected={selected}
          defaultMonth={selected}
          autoFocus
          onSelect={(date) => {
            const next = date
              ? [
                  String(date.getFullYear()).padStart(4, '0'),
                  String(date.getMonth() + 1).padStart(2, '0'),
                  String(date.getDate()).padStart(2, '0'),
                ].join('-')
              : '';
            onChange(next);
            onBlur();
            setOpen(false);
          }}
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            className="mx-2 mb-2"
            onClick={() => {
              onChange('');
              onBlur();
              setOpen(false);
            }}
          >
            清除日期
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
