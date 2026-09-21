/**
 * @author Codex
 * @description Presents clear send timing and stop controls while a Session Agent is running.
 */

import { useRef } from 'react';
import { useSafeState } from 'ahooks';
import { ArrowUpIcon, ChevronDownIcon, CornerDownRightIcon, ListEndIcon, SquareIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { ButtonGroup } from '@octopus/ui/components/button-group';
import { Spinner } from '@octopus/ui/components/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useI18n } from '@/i18n/use-i18n';

export type RunningMessageMode = 'steer' | 'follow-up';

export interface RunningMessageControlsProps {
  disabled?: boolean;
  mode: RunningMessageMode;
  followUpCount: number;
  sendDisabled: boolean;
  /**
   * Updates the default timing used by the send button and Enter key.
   */
  onModeChange(mode: RunningMessageMode): void;
  /**
   * Sends the current draft using the selected timing.
   */
  onSend(): void;
  /**
   * Stops the active Agent run without discarding queued UI state.
   */
  onStop(): Promise<void>;
}

/**
 * Renders a compact Codex-style split send action plus an independent stop control.
 *
 * @param props - Running message mode, queue state, and interaction callbacks.
 * @returns Controls that keep send timing understandable without exposing protocol names.
 */
export function RunningMessageControls({
  disabled = false,
  mode,
  followUpCount,
  sendDisabled,
  onModeChange,
  onSend,
  onStop,
}: RunningMessageControlsProps) {
  const { t } = useI18n();
  const stoppingRef = useRef(false);
  const [stopping, setStopping] = useSafeState(false);
  const steering = mode === 'steer';
  const ModeIcon = steering ? CornerDownRightIcon : ListEndIcon;
  const modeLabel = steering
    ? t('session.runningControls.guideNow', 'Guide now')
    : t('session.runningControls.queueNext', 'Queue next');

  /**
   * Narrows the Base UI radio value before updating the running-message contract.
   *
   * @param value - Unknown value emitted by the dropdown radio group.
   */
  function handleModeChange(value: unknown): void {
    if (value === 'steer' || value === 'follow-up') {
      onModeChange(value);
    }
  }

  /**
   * Locks the stop control before dispatch so repeated clicks cannot enqueue duplicate aborts.
   */
  async function handleStop(): Promise<void> {
    if (disabled || stoppingRef.current) {
      return;
    }
    stoppingRef.current = true;
    setStopping(true);
    try {
      await onStop();
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <ButtonGroup>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="secondary"
                aria-label={`Send timing: ${modeLabel}`}
                disabled={disabled}
              >
                <ModeIcon data-icon="inline-start" />
                <span className="hidden sm:inline text-xs">{modeLabel}</span>
                <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" side="top" className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t('session.runningControls.menuLabel', 'Send while Dr.Octopus is working')}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup value={mode} onValueChange={handleModeChange}>
                <DropdownMenuRadioItem value="steer">
                  <CornerDownRightIcon />
                  <span className="flex flex-col gap-0.5">
                    <span>{t('session.runningControls.guideTitle', 'Guide the current run')}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        'session.runningControls.guideDescription',
                        'Influence the next Agent turn. Press Enter.'
                      )}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="follow-up">
                  <ListEndIcon />
                  <span className="flex flex-col gap-0.5">
                    <span>{t('session.runningControls.queueTitle', 'Send after this run')}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        'session.runningControls.queueDescription',
                        'Wait until the current task finishes. Press Alt+Enter.'
                      )}
                      {followUpCount > 0
                        ? t('session.runningControls.queuedSuffix', ' {{count}} already queued.', {
                            count: followUpCount,
                          })
                        : ''}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                aria-label={`${modeLabel}: send message`}
                disabled={disabled || sendDisabled}
                onClick={onSend}
              >
                <ArrowUpIcon />
              </Button>
            }
          />
          <TooltipContent>
            {steering
              ? t('session.runningControls.guideTooltip', 'Guide current run · Enter')
              : t('session.runningControls.queueTooltip', 'Queue after run · Enter')}
          </TooltipContent>
        </Tooltip>
      </ButtonGroup>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="destructive"
              size="icon"
              aria-label={stopping ? 'Stopping current run' : 'Stop current run'}
              disabled={disabled || stopping}
              onClick={handleStop}
            >
              {stopping ? <Spinner /> : <SquareIcon fill="currentColor" />}
            </Button>
          }
        />
        <TooltipContent>
          {stopping
            ? t('session.runningControls.stoppingTooltip', 'Stopping current run…')
            : t('session.runningControls.stopTooltip', 'Stop current run')}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
