/**
 * @author Codex
 * @description Groups drafting actions behind one menu while retaining native file selection and editor-focus handoff.
 */

import { useRef } from 'react';
import { useEventListener } from 'ahooks';
import {
  AtSignIcon,
  ImagePlusIcon,
  PaperclipIcon,
  PlusIcon,
  SquareSlashIcon,
  TargetIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { useI18n } from '@/i18n/use-i18n';
import { COMPOSER_IMAGE_ACCEPT } from './utils/composer-images';
import type { ComposerTrigger } from '@/components/AgentComposerEditor/types';

export interface ComposerToolsMenuProps {
  disabled?: boolean;
  /**
   * Stages files using the owning Composer's existing upload flow.
   */
  onAttach(files: File[]): void;
  /**
   * Stages visual inputs through the same resource admission flow as other files.
   */
  onAttachImages(files: File[]): void;
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
  onAttachImages,
  onInsertTrigger,
  onInsertGoal,
  onReturnFocus,
}: ComposerToolsMenuProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingAction = useRef<(() => void) | 'picker' | undefined>(undefined);
  useEventListener('cancel', onReturnFocus, { target: inputRef });
  useEventListener('cancel', onReturnFocus, { target: imageInputRef });
  const items = [
    {
      id: 'image',
      label: t('session.composer.addImages', 'Add images'),
      icon: ImagePlusIcon,
    },
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
      case 'image':
        pendingAction.current = 'picker';
        imageInputRef.current?.click();
        break;
      case 'attachment':
        pendingAction.current = 'picker';
        inputRef.current?.click();
        break;
      case 'commands':
        pendingAction.current = () => onInsertTrigger('/');
        break;
      case 'mention':
        pendingAction.current = () => onInsertTrigger('@');
        break;
      case 'goal':
        pendingAction.current = onInsertGoal;
        break;
    }
  }

  return (
    <>
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept={COMPOSER_IMAGE_ACCEPT}
        disabled={disabled}
        className="hidden"
        aria-label="Composer images"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          onAttachImages(files);
          onReturnFocus();
        }}
      />
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
            pendingAction.current = undefined;
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
            const action = pendingAction.current;
            pendingAction.current = undefined;
            if (typeof action === 'function') {
              action();
              return false;
            }
            return action !== 'picker';
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
