/**
 * @author Codex
 * @description Displays authoritative Pi context-window usage and auto-compaction status.
 */

import { GaugeIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@octopus/ui/components/popover';
import { Progress, ProgressLabel, ProgressValue } from '@octopus/ui/components/progress';
import { useI18n } from '@/i18n/use-i18n';
import type { ContextUsageDto } from '@octopus/shared/protocol';

export interface ContextUsageIndicatorProps {
  usage?: ContextUsageDto;
  autoCompactionEnabled: boolean;
}

/**
 * Formats token counts compactly while keeping exact values in the expanded surface.
 */
function formatTokens(tokens: number): string {
  return new Intl.NumberFormat('en', {
    notation: tokens >= 1_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(tokens);
}

/**
 * Shows an unknown state immediately after compaction or before Pi has reported usage.
 */
export function ContextUsageIndicator({ usage, autoCompactionEnabled }: ContextUsageIndicatorProps) {
  const { t } = useI18n();
  const percent = usage?.percent ?? null;
  const label = percent === null ? '--%' : `${String(Math.round(percent))}%`;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label={`Context usage ${label}`}
          >
            <GaugeIcon data-icon="inline-start" />
            <span className="text-xs">{label}</span>
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{t('session.contextUsage.title', 'Context window')}</PopoverTitle>
          <PopoverDescription>
            {autoCompactionEnabled
              ? t('session.contextUsage.autoCompactionEnabled', 'Auto-Compaction is enabled.')
              : t(
                  'session.contextUsage.autoCompactionDisabled',
                  'Auto-Compaction is disabled for this session.'
                )}
          </PopoverDescription>
        </PopoverHeader>
        <Progress value={percent}>
          <ProgressLabel>
            {usage?.tokens === null || usage === undefined
              ? t('session.contextUsage.waiting', 'Waiting for usage')
              : t('session.contextUsage.tokensSummary', '{{used}} / {{total}} tokens', {
                  used: formatTokens(usage.tokens),
                  total: formatTokens(usage.contextWindow),
                })}
          </ProgressLabel>
          <ProgressValue>{() => label}</ProgressValue>
        </Progress>
      </PopoverContent>
    </Popover>
  );
}
