/**
 * @author Codex
 * @description Renders a reusable controlled group for selecting exactly one labeled option.
 */

import { ToggleGroup, ToggleGroupItem } from '@octopus/ui/components/toggle-group';
import type { ReactNode } from 'react';

export interface ToggleButtonGroupOption<TKey extends string> {
  key: TKey;
  label: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}

export interface ToggleButtonGroupProps<TKey extends string> {
  options: readonly ToggleButtonGroupOption<TKey>[];
  selectedKey: TKey;
  ariaLabel: string;
  className?: string;
  /**
   * Reports a newly selected option while preventing the group from becoming empty.
   */
  onSelectedKeyChange(selectedKey: TKey): void;
}

/**
 * Provides an accessible, controlled single-selection toggle group.
 */
export function ToggleButtonGroup<TKey extends string>({
  options,
  selectedKey,
  ariaLabel,
  className,
  onSelectedKeyChange,
}: ToggleButtonGroupProps<TKey>) {
  /**
   * Preserves the single-selection contract when the active toggle is pressed again.
   */
  function handleValueChange(selectedKeys: string[]) {
    const nextSelectedOption = options.find((option) => option.key === selectedKeys[0]);
    if (nextSelectedOption !== undefined) {
      onSelectedKeyChange(nextSelectedOption.key);
    }
  }

  return (
    <ToggleGroup
      aria-label={ariaLabel}
      className={className}
      value={[selectedKey]}
      variant="outline"
      spacing={0}
      onValueChange={handleValueChange}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.key}
          value={option.key}
          aria-label={option.ariaLabel}
          disabled={option.disabled}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
