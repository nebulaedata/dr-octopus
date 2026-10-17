/**
 * @author Codex
 * @description Promotes the local Executor through one clickable sidebar card with an independent temporary dismissal.
 */

import { XIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { DialogTrigger } from '@octopus/ui/components/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useI18n } from '@/i18n/use-i18n';
import { useExecutorDownloadStore } from '@/stores/executor-download';

/**
 * Keeps the promotion accessible by keyboard while preventing dismissal from opening the download dialog.
 */
export function ExecutorDownloadCard() {
  const { t } = useI18n();
  const dismissed = useExecutorDownloadStore((state) => state.dismissed);
  const dismiss = useExecutorDownloadStore((state) => state.dismiss);

  if (dismissed) {
    return null;
  }

  return (
    <Card
      data-testid="executor-download-card"
      className="group/executor relative isolate mx-3.5 mb-3 min-h-36 shrink-0 gap-0 overflow-hidden border border-primary/30 bg-linear-to-tr from-primary/5 via-sidebar to-primary/25 py-0 text-sidebar-foreground ring-0 has-focus-visible:ring-2 has-focus-visible:ring-ring"
    >
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Download Executor"
            className="absolute inset-0 cursor-pointer rounded-xl outline-none motion-safe:transition-colors hover:bg-primary/5 focus-visible:bg-primary/5"
          />
        }
      />
      <CardHeader className="pointer-events-none relative max-w-[78%] gap-2 px-4 py-4">
        <span className="text-[10px] font-semibold tracking-[0.16em] text-primary" translate="no">
          {'EXECUTOR'}
        </span>
        <CardTitle className="text-lg leading-snug font-semibold text-balance">
          {t('executorDownload.card.title', 'Give AI the power to act')}
        </CardTitle>
        <CardDescription className="max-w-[calc(100%-1.5rem)] text-xs leading-relaxed text-sidebar-foreground/75">
          {t('executorDownload.card.description', 'Connect your computer. Expand what your agent can do.')}
        </CardDescription>
      </CardHeader>
      <img
        src="/assets/executor/executor-mascot.png"
        alt=""
        aria-hidden="true"
        width={1086}
        height={1448}
        draggable={false}
        className="pointer-events-none absolute right-0 bottom-1 w-[34%] max-w-24 select-none"
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Temporarily hide Executor card"
              className="absolute top-1 right-1 rounded-full"
              onClick={dismiss}
            />
          }
        >
          <XIcon />
        </TooltipTrigger>
        <TooltipContent side="top">
          {t('executorDownload.card.dismiss', 'Hide until the page is refreshed')}
        </TooltipContent>
      </Tooltip>
    </Card>
  );
}
