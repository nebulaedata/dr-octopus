/**
 * @author Codex
 * @description Renders the complete slash-command catalog with local search feedback and source counts.
 */

import { useLayoutEffect, useRef } from 'react';
import { CommandIcon, SearchIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@octopus/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@octopus/ui/components/popover';
import { useI18n } from '@/i18n/use-i18n';
import type { MenuRenderFn } from '@lexical/react/LexicalTypeaheadMenuPlugin';
import type { SlashCommandCatalog, SlashCommandGroup, SlashCommandOption } from './slash-command-catalog';

type SlashCommandMenuProps = Parameters<MenuRenderFn<SlashCommandOption>>[1] & {
  catalog: SlashCommandCatalog;
};

/**
 * Keeps search feedback and source totals visible while command groups scroll independently.
 */
export function SlashCommandMenu({
  catalog,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
  options,
}: SlashCommandMenuProps) {
  const { t } = useI18n();
  const commandListRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
  const optionsByName = new Map(options.map((option, index) => [option.command.name, { option, index }]));

  useLayoutEffect(() => {
    if (selectedIndex === null) {
      return;
    }
    ensureCommandOptionVisible(commandListRef.current, options[selectedIndex]?.ref?.current);
  }, [options, selectedIndex]);

  return (
    <Popover open>
      <PopoverTrigger
        aria-hidden
        nativeButton={false}
        tabIndex={-1}
        // Lexical places its anchor below the query; cover its text height before positioning the popup.
        render={<span className="pointer-events-none block h-full w-px -translate-y-full" />}
      />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={10}
        initialFocus={false}
        finalFocus={false}
        className="max-h-[min(var(--available-height),calc(50dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-0"
      >
        <Command
          className="min-h-0"
          shouldFilter={false}
          value={selectedIndex === null ? undefined : options[selectedIndex]?.key}
        >
          <div className="shrink-0 border-b p-2" onMouseDown={(event) => event.preventDefault()}>
            <div
              role="search"
              aria-label="Slash command search; continue typing in the Composer"
              className="flex min-h-8 items-center gap-2 rounded-md bg-muted/60 px-2 text-sm"
            >
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <span
                className={
                  catalog.searching
                    ? 'min-w-0 flex-1 truncate'
                    : 'min-w-0 flex-1 truncate text-muted-foreground'
                }
              >
                {catalog.searching
                  ? `/${catalog.query}`
                  : t('session.composer.slashSearchPlaceholder', 'Search command names and descriptions…')}
              </span>
              <Badge variant="secondary">
                {catalog.searching ? `${catalog.matchedCount}/${catalog.totalCount}` : catalog.totalCount}
              </Badge>
            </div>
            <div
              className="mt-2 flex flex-wrap gap-1"
              aria-label="Command counts by source"
            >
              {catalog.groups.map((group) => (
                <Badge
                  key={group.source}
                  variant="outline"
                  className="cursor-pointer hover:bg-muted"
                  aria-label={`Jump to ${group.source} commands`}
                  render={<button type="button" tabIndex={-1} />}
                  onClick={() =>
                    scrollToCommandGroup(commandListRef.current, groupRefs.current.get(group.source))
                  }
                >
                  {formatGroupCount(group, catalog.searching)}
                </Badge>
              ))}
            </div>
          </div>
          <CommandList ref={commandListRef} className="max-h-[min(32rem,60vh)]">
            {catalog.matchedCount === 0 ? (
              <CommandEmpty>{t('session.composer.slashNoMatch', 'No matching commands.')}</CommandEmpty>
            ) : null}
            {catalog.groups.map((group) =>
              group.commands.length === 0 ? null : (
                <CommandGroup
                  key={group.source}
                  ref={(element) => {
                    if (element === null) {
                      groupRefs.current.delete(group.source);
                    } else {
                      groupRefs.current.set(group.source, element);
                    }
                  }}
                  heading={formatGroupCount(group, catalog.searching)}
                  className="**:[[cmdk-group-heading]]:sticky **:[[cmdk-group-heading]]:top-0 **:[[cmdk-group-heading]]:z-10 **:[[cmdk-group-heading]]:bg-popover"
                >
                  {group.commands.map((command) => {
                    const selection = optionsByName.get(command.name);
                    const description = command.enabled
                      ? command.description
                      : (command.disabledReason ?? command.description);
                    if (selection === undefined) {
                      return (
                        <CommandItem key={command.name} value={`disabled:${command.name}`} disabled>
                          <CommandIcon />
                          <CommandLabel name={command.name} description={description} />
                          <Badge variant="secondary">
                            {t('session.composer.slashComingSoon', 'Coming soon')}
                          </Badge>
                        </CommandItem>
                      );
                    }
                    return (
                      <CommandItem
                        key={selection.option.key}
                        ref={(element) => selection.option.setRefElement(element)}
                        value={selection.option.key}
                        aria-selected={selectedIndex === selection.index}
                        data-selected={selectedIndex === selection.index ? 'true' : undefined}
                        onMouseMove={() => setHighlightedIndex(selection.index)}
                        onSelect={() => selectOptionAndCleanUp(selection.option)}
                      >
                        <CommandIcon />
                        <CommandLabel name={command.name} description={description} />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface CommandLabelProps {
  name: string;
  description?: string;
}

/**
 * Presents a scan-friendly command name while retaining two lines of descriptive context.
 */
function CommandLabel({ name, description }: CommandLabelProps) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate">/{name}</span>
      {description === undefined ? null : (
        <span className="line-clamp-2 text-xs text-muted-foreground" title={description}>
          {description}
        </span>
      )}
    </span>
  );
}

/**
 * Formats source totals as `skill(23)` and switches to matched/total during search.
 */
function formatGroupCount(group: SlashCommandGroup, searching: boolean): string {
  return searching
    ? `${group.source}(${group.commands.length}/${group.totalCount})`
    : `${group.source}(${group.totalCount})`;
}

/**
 * Scrolls one source into view without transferring focus away from the Lexical editor.
 *
 * @param list - Scroll container containing the command groups.
 * @param group - Requested source group, when it currently has visible matches.
 */
function scrollToCommandGroup(list: HTMLDivElement | null, group: HTMLDivElement | undefined): void {
  if (list === null || group === undefined) {
    return;
  }
  list.scrollTo({
    top: group.offsetTop - list.offsetTop,
    behavior: 'smooth',
  });
}

/**
 * Keeps the Lexical-highlighted option inside the command list without scrolling the surrounding page.
 *
 * @param list - Command list that owns vertical scrolling.
 * @param option - Currently highlighted command element.
 */
function ensureCommandOptionVisible(
  list: HTMLDivElement | null,
  option: HTMLElement | null | undefined
): void {
  if (list === null || option === null || option === undefined) {
    return;
  }
  const listRect = list.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  const heading = option.closest('[cmdk-group]')?.querySelector<HTMLElement>('[cmdk-group-heading]');
  const topBoundary = listRect.top + (heading?.getBoundingClientRect().height ?? 0) + 4;
  const bottomBoundary = listRect.bottom - 4;

  if (optionRect.top < topBoundary) {
    list.scrollTop -= topBoundary - optionRect.top;
  } else if (optionRect.bottom > bottomBoundary) {
    list.scrollTop += optionRect.bottom - bottomBoundary;
  }
}
