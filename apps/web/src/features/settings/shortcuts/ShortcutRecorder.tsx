/**
 * @author Claude
 * @description Inline key-capture box for one shortcut row: suspends global dispatch, records the next valid combo, and resolves binding conflicts with a one-click replace.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@octopus/ui/components/button';
import { useI18n } from '@/i18n/use-i18n';
import { useShortcutsStore } from '@/stores/shortcuts';
import { findBindingConflict, normalizeEvent, shortcutKey } from '@/lib/shortcuts';
import { cn } from '@octopus/ui/lib/utils';
import { useShortcutCommandLabels } from '@/features/settings/hooks/use-shortcut-command-labels';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ShortcutCommandId } from '@/lib/shortcuts';

export interface ShortcutRecorderProps {
  commandId: ShortcutCommandId;
  /**
   * Closes the recorder after apply, clear, replace, or cancel.
   */
  onFinished(): void;
}

interface PendingConflict {
  combo: string;
  withId: ShortcutCommandId;
}

/**
 * Captures the next keystroke for `commandId`; Escape cancels and Backspace/Delete clears the binding.
 *
 * The box keeps the exact footprint of the binding display it replaces (fixed column width, h-8);
 * hints and conflict actions float in an overlay so the table geometry never shifts.
 */
export function ShortcutRecorder({ commandId, onFinished }: ShortcutRecorderProps) {
  const { t } = useI18n();
  const commandLabels = useShortcutCommandLabels();
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const overrides = useShortcutsStore((state) => state.overrides);
  const setBinding = useShortcutsStore((state) => state.setBinding);
  const clearBinding = useShortcutsStore((state) => state.clearBinding);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    shortcutKey.setSuspended(true);
    boxRef.current?.focus();
    return () => shortcutKey.setSuspended(false);
  }, []);

  const applyCombo = (combo: string) => {
    const conflictId = findBindingConflict(overrides, commandId, combo);
    if (conflictId !== undefined) {
      setConflict({ combo, withId: conflictId });
      return;
    }
    setBinding(commandId, combo);
    onFinished();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      onFinished();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      clearBinding(commandId);
      onFinished();
      return;
    }
    const combo = normalizeEvent(event.nativeEvent);
    if (combo !== null) {
      applyCombo(combo);
    }
  };

  const conflictLabel = conflict === null ? undefined : commandLabels[conflict.withId];

  return (
    <div
      className="relative flex h-8 w-full items-center"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onFinished();
        }
      }}
    >
      <div
        ref={boxRef}
        tabIndex={0}
        role="button"
        aria-label="Record shortcut"
        className={cn(
          'flex h-8 w-full items-center rounded-md border border-ring px-2 text-xs outline-none ring-ring/50 ring-[3px]',
          conflict === null ? 'text-muted-foreground' : 'text-destructive'
        )}
        onKeyDown={handleKeyDown}
      >
        {conflict === null
          ? t('settings.shortcuts.recordPrompt', 'Press a new shortcut…')
          : t('settings.shortcuts.conflict', 'Conflicts with “{{command}}”', { command: conflictLabel })}
      </div>
      <div className="absolute top-full left-0 z-10 mt-1 flex w-max items-center gap-2 rounded-md border bg-popover p-2 text-xs shadow-md">
        {conflict === null ? (
          <span className="whitespace-nowrap text-muted-foreground">
            {t('settings.shortcuts.recordHint', 'Esc to cancel · Backspace to clear')}
          </span>
        ) : (
          <>
            <Button
              size="xs"
              onClick={() => {
                clearBinding(conflict.withId);
                setBinding(commandId, conflict.combo);
                onFinished();
              }}
            >
              {t('settings.shortcuts.replace', 'Replace')}
            </Button>
            <Button size="xs" variant="outline" onClick={onFinished}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
