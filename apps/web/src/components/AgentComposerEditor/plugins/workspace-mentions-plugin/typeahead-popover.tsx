/**
 * @author Codex
 * @description Renders Workspace mention options in a keyboard-aware shadcn Command Popover.
 */

import { createPortal } from 'react-dom';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@octopus/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@octopus/ui/components/popover';
import type { MenuOption, MenuRenderFn } from '@lexical/react/LexicalTypeaheadMenuPlugin';
import type { ComponentType } from 'react';
import type { LexicalEditor } from 'lexical';

export interface PresentedMenuOption extends MenuOption {
  group: string;
  label: string;
  description?: string;
  iconComponent: ComponentType;
  disabled?: boolean;
}

/**
 * Creates the visual menu adapter for Workspace mention options.
 */
export function createTypeaheadPopoverRenderer<TOption extends PresentedMenuOption>(
  emptyLabel: string,
  editor: LexicalEditor
): MenuRenderFn<TOption> {
  return (anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex, options }) => {
    const anchor = anchorElementRef.current;
    const container = editor.getRootElement()?.parentElement;
    if (anchor === null || container === null || container === undefined) {
      return null;
    }
    const groups = new Map<string, TOption[]>();
    for (const option of options) {
      groups.set(option.group, [...(groups.get(option.group) ?? []), option]);
    }
    return createPortal(
      <Popover open>
        <PopoverTrigger
          aria-hidden
          nativeButton={false}
          tabIndex={-1}
          // Anchor to the editor wrapper so the menu shares its width and stays above every text line.
          render={<span className="pointer-events-none absolute inset-x-0 top-0 h-px" />}
        />
        <PopoverContent
          align="start"
          side="top"
          sideOffset={10}
          initialFocus={false}
          finalFocus={false}
          className="max-h-[min(var(--available-height),calc(50dvh-2rem))] w-(--anchor-width) overflow-hidden p-0"
        >
          <Command
            className="min-h-0"
            shouldFilter={false}
            value={selectedIndex === null ? undefined : options[selectedIndex]?.key}
          >
            <CommandList>
              {options.length === 0 ? <CommandEmpty>{emptyLabel}</CommandEmpty> : null}
              {[...groups].map(([group, groupOptions]) => (
                <CommandGroup key={group} heading={group}>
                  {groupOptions.map((option) => {
                    const index = options.indexOf(option);
                    const Icon = option.iconComponent;
                    return (
                      <CommandItem
                        key={option.key}
                        ref={(element) => option.setRefElement(element)}
                        value={option.key}
                        aria-selected={selectedIndex === index}
                        data-selected={selectedIndex === index ? 'true' : undefined}
                        disabled={option.disabled}
                        onMouseMove={() => {
                          if (option.disabled !== true) {
                            setHighlightedIndex(index);
                          }
                        }}
                        onSelect={() => selectOptionAndCleanUp(option)}
                      >
                        <Icon />
                        <span className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="min-w-0 flex-1 truncate" title={option.label}>
                            {option.label}
                          </span>
                          {!option.description || option.description === option.label ? null : (
                            <span
                              className="max-w-1/2 truncate text-xs text-muted-foreground"
                              title={option.description}
                            >
                              {option.description}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>,
      container
    );
  };
}
