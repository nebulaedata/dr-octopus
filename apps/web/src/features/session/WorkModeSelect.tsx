/**
 * @author Codex
 * @description Presents mutually exclusive Agent, Plan and knowledge modes on the same Session.
 */

import React from 'react';
import { AstroidIcon, CheckIcon, LibraryBigIcon, NotebookPenIcon } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { Kbd } from '@octopus/ui/components/kbd';
import { useI18n } from '@/i18n/use-i18n';
import type { AgentWorkMode } from './composer-types';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Builds the work mode choices with localized labels and descriptions.
 */
function getWorkModeItems(t: Translate) {
  return [
    {
      value: 'agent',
      label: t('session.workMode.agent', 'Agent'),
      description: t('session.workMode.agentDescription', 'Normal tool-enabled work'),
      icon: AstroidIcon,
    },
    {
      value: 'plan',
      label: t('session.workMode.plan', 'Plan'),
      description: t('session.workMode.planDescription', 'Present a plan before executing'),
      icon: NotebookPenIcon,
    },
    {
      value: 'knowledge',
      label: t('session.knowledgeMode.title', 'Knowledge Q&A'),
      description: t(
        'session.workMode.knowledgeDescription',
        'Search knowledge materials; answers include citations'
      ),
      icon: LibraryBigIcon,
    },
  ] satisfies Array<{
    value: AgentWorkMode;
    label: string;
    description: string;
    icon: typeof AstroidIcon;
  }>;
}

export interface WorkModeSelectProps {
  /**
   * Keeps the trigger usable while its Agent options are not loaded yet.
   */
  loaded?: boolean;
  knowledgeAvailable?: boolean;
  planAvailable: boolean;
  disabled?: boolean;
  value: AgentWorkMode;
  /**
   * Updates the frontend work-mode selection.
   */
  onValueChange(value: AgentWorkMode): void;
}

/**
 * Delegates enabled work-mode changes to the Session runtime control plane.
 */
export function WorkModeSelect({
  loaded = true,
  knowledgeAvailable = false,
  disabled = false,
  planAvailable,
  value,
  onValueChange,
}: WorkModeSelectProps) {
  const { t } = useI18n();
  const workModeItems = getWorkModeItems(t);
  return (
    <Select
      disabled={disabled}
      items={loaded ? workModeItems : []}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) {
          onValueChange(nextValue);
        }
      }}
    >
      <SelectTrigger
        size="sm"
        className="w-8 shrink-0 justify-center gap-0 border-0 px-0 hover:bg-muted max-md:data-[size=sm]:h-8 md:w-fit md:justify-between md:gap-1.5 md:pl-2.5 md:pr-2 [&>svg]:hidden md:[&>svg]:block"
        aria-label="Agent work mode"
      >
        <SelectValue className="justify-center md:justify-start">
          {(selectedValue: AgentWorkMode) => {
            const selected = workModeItems.find((item) => item.value === selectedValue);
            const Icon = selected?.icon ?? React.Fragment;
            return (
              <span
                className="flex items-center gap-1 text-xs"
                title={selected?.label ?? t('session.workMode.fallbackTitle', 'Agent mode')}
              >
                <Icon />
                <span className="hidden md:inline">
                  {selected?.label ?? t('session.workMode.unknown', 'Unknown')}
                </span>
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="min-w-60">
        <SelectGroup>
          <SelectLabel>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span>{t('session.workMode.label', 'Agent Modes')}</span>
              <span className="flex items-center gap-1 text-xs">
                <Kbd>{'⇧'}</Kbd>
                <Kbd>{'⇩'}</Kbd>
                <span>{'+'}</span>
                <Kbd>{'Enter'}</Kbd>
              </span>
            </div>
          </SelectLabel>
          {(loaded ? workModeItems : []).map((item) => {
            const Icon = item.icon;
            return (
              <SelectItem
                key={item.value}
                value={item.value}
                disabled={
                  (item.value === 'knowledge' && !knowledgeAvailable) ||
                  (item.value === 'plan' && !planAvailable)
                }
                className="group pr-1.5"
                render={
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Icon />
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <span className="inline-block truncate" title={item.label}>
                        {item.label}
                      </span>
                      <span
                        className="inline-block truncate text-xs text-muted-foreground"
                        title={item.description}
                      >
                        {item.description}
                      </span>
                    </div>
                    <CheckIcon className="text-muted-foreground hidden group-data-[selected='']:block" />
                  </div>
                }
              />
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
