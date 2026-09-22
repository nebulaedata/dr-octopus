/**
 * @author Codex
 * @description Presents allow, deny, and ask permission defaults aligned with the planned Pi permission adapter.
 */

import React from 'react';
import { CheckIcon, HandIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react';
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
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import type { PermissionMode } from './composer-types';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Builds the permission mode choices with localized labels and descriptions.
 */
function getPermissionItems(t: Translate) {
  return [
    {
      value: 'ask',
      label: t('session.permission.ask', 'Ask'),
      description: t(
        'session.permission.askDescription',
        'Always ask when editing files and using the Internet.'
      ),
      icon: HandIcon,
    },
    {
      value: 'auto',
      label: t('session.permission.auto', 'Auto'),
      description: t(
        'session.permission.autoDescription',
        'Request approval only for detected risky operations.'
      ),
      icon: ShieldCheckIcon,
    },
    {
      value: 'full',
      label: t('session.permission.full', 'Full-access'),
      description: t(
        'session.permission.fullDescription',
        'Unrestricted access to local files and the Internet.'
      ),
      icon: ShieldAlertIcon,
    },
  ] satisfies Array<{
    value: PermissionMode;
    label: string;
    description: string;
    icon: typeof HandIcon;
  }>;
}

export interface PermissionSelectProps {
  /**
   * Keeps the trigger usable while its Agent options are not loaded yet.
   */
  loaded?: boolean;
  disabled?: boolean;
  value: PermissionMode;
  /**
   * Updates the frontend permission policy selection.
   */
  onValueChange(value: PermissionMode): void;
}

/**
 * Highlights silent allow as the high-attention choice without claiming runtime enforcement.
 */
export function PermissionSelect({
  loaded = true,
  disabled = false,
  value,
  onValueChange,
}: PermissionSelectProps) {
  const { t } = useI18n();
  const permissionItems = getPermissionItems(t);
  return (
    <Select
      disabled={disabled}
      items={loaded ? permissionItems : []}
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
        aria-label="Permission approval mode"
      >
        <SelectValue className="justify-center md:justify-start">
          {(selectedValue: PermissionMode) => {
            const selected = permissionItems.find((item) => item.value === selectedValue);
            const Icon = selected?.icon ?? React.Fragment;
            return (
              <span
                className={cn(
                  'flex items-center gap-1',
                  selectedValue === 'full' && 'text-yellow-600 dark:text-yellow-400'
                )}
                title={selected?.label ?? t('session.permission.fallback', 'Permission')}
              >
                <Icon />
                <span className="hidden text-xs md:inline">
                  {selected?.label ?? t('session.permission.fallback', 'Permission')}
                </span>
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="min-w-80">
        <SelectGroup>
          <SelectLabel>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span>{t('session.permission.label', 'Permission Mode')}</span>
              <span className="flex items-center gap-1 text-xs">
                <Kbd>{'⇧'}</Kbd>
                <Kbd>{'⇩'}</Kbd>
                <span>{'+'}</span>
                <Kbd>{'Enter'}</Kbd>
              </span>
            </div>
          </SelectLabel>
          {(loaded ? permissionItems : []).map((item) => {
            const Icon = item.icon;
            return (
              <SelectItem
                key={item.value}
                value={item.value}
                className="group pr-1.5"
                render={
                  <div
                    className={cn(
                      'flex items-center gap-2 overflow-hidden',
                      item.value === 'full' && 'text-yellow-600 dark:text-yellow-400'
                    )}
                  >
                    <Icon />
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <span className="inline-block truncate" title={item.label}>
                        {item.label}
                      </span>
                      <span className="inline-block truncate text-xs" title={item.description}>
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
