/**
 * @author Codex
 * @description Groups drafting actions behind one menu while retaining native file selection and editor-focus handoff.
 */

import { useRef } from 'react';
import { useEventListener } from 'ahooks';
import { AtSignIcon, PaperclipIcon, PlusIcon, SquareSlashIcon, TargetIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { useI18n } from '@/i18n/use-i18n';
import type { ComposerTrigger } from '@/components/AgentComposerEditor/types';

export interface ComposerToolsMenuProps {
  disabled?: boolean;
  /**
   * Stages files using the owning Composer's existing upload flow.
   */
  onAttach(files: File[]): void;
  /**
   * Restores the editor caret and opens the corresponding typeahead.
   */
  onInsertTrigger(trigger: ComposerTrigger): void;
  /**
   * Inserts the complete goal command without submitting the draft.
   */
  onInsertGoal(): void;
  /**
   * Returns focus after native file selection or cancellation.
   */
  onReturnFocus(): void;
}

/**
 * Keeps the file input outside the closing menu and defers text insertion until its focus scope is released.
 */
export function ComposerToolsMenu({
  disabled = false,
  onAttach,
  onInsertTrigger,
  onInsertGoal,
  onReturnFocus,
}: ComposerToolsMenuProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingEditorAction = useRef<(() => void) | undefined>(undefined);
  useEventListener('cancel', onReturnFocus, { target: inputRef });
  const items = [
    {
      id: 'attachment',
      label: t('session.composer.attachFiles', 'Attach files'),
      icon: PaperclipIcon,
    },
    {
      id: 'commands',
      label: t('session.composer.commandsTooltip', 'Commands'),
      icon: SquareSlashIcon,
    },
    {
      id: 'mention',
      label: t('session.composer.mentionTooltip', 'Mention file or folder'),
      icon: AtSignIcon,
    },
    {
      id: 'goal',
      label: t('session.composer.goalTooltip', 'Goal'),
      icon: TargetIcon,
    },
  ] as const;

  /**
   * Opens the picker during the user gesture, or queues editor work for the menu's final-focus handoff.
   */
  function handleAction(id: (typeof items)[number]['id']): void {
    switch (id) {
      case 'attachment':
        inputRef.current?.click();
        break;
      case 'commands':
        pendingEditorAction.current = () => onInsertTrigger('/');
        break;
      case 'mention':
        pendingEditorAction.current = () => onInsertTrigger('@');
        break;
      case 'goal':
        pendingEditorAction.current = onInsertGoal;
        break;
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={disabled}
        className="hidden"
        aria-label="Composer attachments"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          onAttach(files);
          onReturnFocus();
        }}
      />
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            pendingEditorAction.current = undefined;
          }
        }}
      >
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Add to message"
              title={t('session.composer.addTools', 'Add to message')}
            />
          }
        >
          <PlusIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-60 max-w-[calc(100vw-2rem)]"
          finalFocus={() => {
            const action = pendingEditorAction.current;
            pendingEditorAction.current = undefined;
            if (action) {
              action();
              return false;
            }
            return true;
          }}
        >
          <DropdownMenuGroup>
            {items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                disabled={disabled}
                className="min-h-9 gap-2"
                onClick={() => handleAction(item.id)}
              >
                <item.icon aria-hidden="true" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
