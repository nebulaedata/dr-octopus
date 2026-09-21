/**
 * @author Codex
 * @description Presents a committed long-term memory receipt with a direct management entry.
 */

import { Link } from '@tanstack/react-router';
import { ArrowUpRightIcon, BrainIcon, CheckIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { formatMessageTime } from '@/utils/date';
import { useI18n } from '@/i18n/use-i18n';
import type { MemorySaveProjection } from './memory-save-projection';

/**
 * Renders the historical save receipt without querying or inventing remembered content.
 */
export function MemorySaveCard({
  receipt,
  timestamp,
}: {
  receipt: MemorySaveProjection;
  timestamp?: number;
}) {
  const { t } = useI18n();
  const savedAt = new Date(timestamp ?? Number.NaN);
  const dateTime = Number.isNaN(savedAt.getTime()) ? undefined : savedAt.toISOString();
  return (
    <Card className="w-full max-w-xl" aria-label="Long-term memory save receipt">
      <CardHeader className="flex flex-row items-start gap-3.5">
        <div className="relative mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BrainIcon className="size-5" aria-hidden="true" />
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-card ring-2 ring-card">
            <CheckIcon className="size-3" aria-hidden="true" />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <CardTitle className="text-sm font-semibold">
            {t('session.memorySave.title', 'Saved {{count}} long-term memories', { count: receipt.count })}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('session.memorySave.description', 'Available for reference in later conversations.')}
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-x-3 gap-y-1">
          <Button
            nativeButton={false}
            variant="ghost"
            size="icon-sm"
            aria-label="Manage memory"
            title={t('session.memoryTool.manageMemory', 'Manage memory')}
            render={<Link to="/memory" />}
          >
            <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
          <div className="flex items-center text-xs text-muted-foreground gap-x-2">
            <span>{t('session.memorySave.globalMemory', 'Global memory')}</span>
            {timestamp !== undefined && dateTime !== undefined && (
              <time dateTime={dateTime}>{formatMessageTime(timestamp)}</time>
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
