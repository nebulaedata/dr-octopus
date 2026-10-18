/**
 * @author Codex
 * @description Promotes the local Executor through one clickable sidebar card with an independent temporary dismissal.
 */

import { XIcon } from 'lucide-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@octopus/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { useI18n } from '@/i18n/use-i18n';
import { useExecutorDownloadStore } from '@/stores/executor-download';

/**
 * Keeps the promotion accessible by keyboard while preventing dismissal from opening the download dialog.
 */
export function ExecutorDownloadCard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const dismissed = useExecutorDownloadStore((state) => state.dismissed);
  const dismiss = useExecutorDownloadStore((state) => state.dismiss);

  if (dismissed) {
    return null;
  }

  return (
    <Card
      data-testid="executor-download-card"
      className="group/executor relative isolate mx-3.5 mb-3 h-28 shrink-0 gap-0 overflow-hidden border border-primary/30 bg-linear-to-tr from-primary/5 via-sidebar to-primary/25 py-0 text-sidebar-foreground ring-0 has-focus-visible:ring-2 has-focus-visible:ring-ring"
    >
      <button
        type="button"
        aria-label="Download Executor"
        aria-haspopup="dialog"
        aria-expanded={search.executorDownload === true}
        className="absolute inset-0 cursor-pointer rounded-xl outline-none motion-safe:transition-colors hover:bg-primary/5 focus-visible:bg-primary/5"
        onClick={() => {
          void navigate({
            to: '.',
            search: (previous) => ({ ...previous, executorDownload: true }),
            replace: true,
          });
        }}
      />
      <CardHeader className="pointer-events-none relative min-w-0 gap-1.5 py-3 pr-18 pl-4">
        <span className="text-[10px] leading-3 font-semibold tracking-[0.16em] text-primary" translate="no">
          {'EXECUTOR'}
        </span>
        <CardTitle
          className="truncate text-lg leading-5 font-semibold"
          title={t('executorDownload.card.title', 'Give AI the power to act')}
        >
          {t('executorDownload.card.title', 'Give AI the power to act')}
        </CardTitle>
        <CardDescription
          className="line-clamp-2 text-xs leading-4 text-sidebar-foreground/75"
          title={t(
            'executorDownload.card.description',
            'Connect your computer. Expand what your agent can do.'
          )}
        >
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
        className="pointer-events-none absolute right-2 bottom-1 h-auto w-13 select-none"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Temporarily hide Executor card"
        className="absolute top-1 right-1"
        onClick={dismiss}
      >
        <XIcon />
      </Button>
    </Card>
  );
}
