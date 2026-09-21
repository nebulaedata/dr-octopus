/**
 * @author Codex
 * @description Presents compact labeled choices shared by permission scope and policy editors.
 */
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';

import { PermissionActionBadge } from './PermissionActionBadge';
import { getPermissionActions } from './permission-labels';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Keep accessible names and human-readable selected labels consistent across editors.
 */
export function PermissionSelect({
  className,
  value,
  onChange,
  label,
  items,
  disabled = false,
}: {
  className?: string;
  value: string;
  label: string;
  items?: { value: string; label: string }[];
  disabled?: boolean;
  /**
   * Update the controlled draft without persisting it.
   */
  onChange(value: string): void;
}) {
  const { t } = useI18n();
  const isActionSelect = items === undefined;
  const effectiveItems = items ?? getPermissionActions(t);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next);
        }
      }}
      items={effectiveItems}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className={cn('w-full min-w-24', className)}>
        <SelectValue>{isActionSelect ? <PermissionActionBadge action={value} /> : undefined}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {effectiveItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {isActionSelect ? <PermissionActionBadge action={item.value} /> : item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
