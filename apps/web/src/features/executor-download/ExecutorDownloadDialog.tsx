/**
 * @author Codex
 * @description Presents configured Windows Executor downloads and the authorization-based MCP setup flow.
 */

import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  AlertCircleIcon,
  BookOpenIcon,
  DownloadIcon,
  InfoIcon,
  MonitorIcon,
  SettingsIcon,
} from 'lucide-react';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button, buttonVariants } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Separator } from '@octopus/ui/components/separator';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { executorInstallationUrl, readExecutorRelease } from './utils/executor-release';

const release = readExecutorRelease(import.meta.env);

/**
 * Mounts beside the workbench so closed download state cannot make unrelated dialogs nested.
 */
export function ExecutorDownloadDialog() {
  const { t } = useI18n();
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const primaryUrl = release.installerUrl ?? release.archiveUrl;
  const primaryLabel = release.installerUrl
    ? t('executorDownload.installer', 'Download Windows installer')
    : t('executorDownload.archive', 'Download ZIP archive');
  const steps = [
    t('executorDownload.steps.install', 'Install and start Executor.'),
    t(
      'executorDownload.steps.authorize',
      'Create an authorization in Executor and copy the client configuration.'
    ),
    t('executorDownload.steps.connect', 'Add the configuration to your agent’s MCP settings.'),
  ];

  return (
    <Dialog
      open={search.executorDownload === true}
      onOpenChange={(open) => {
        void navigate({
          to: '.',
          search: (previous) => ({ ...previous, executorDownload: open || undefined }),
          replace: true,
        });
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto overscroll-contain p-5 sm:max-w-xl sm:p-7">
        <DialogHeader className="gap-3 pr-5">
          <DialogTitle className="text-xl font-semibold">
            {t('executorDownload.title', 'Download Executor')}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t(
              'executorDownload.description',
              'Let your agent use local files, shell, browser, and desktop tools after you authorize access.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <section className="flex min-w-0 flex-col gap-4 rounded-xl border bg-muted/20 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted">
              <MonitorIcon className="size-6" aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-base font-semibold" translate="no">
                {'Windows x64'}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="break-all tabular-nums" translate="no">{`v${release.version}`}</span>
                <Badge variant="secondary">{t('executorDownload.acceptance', 'Acceptance build')}</Badge>
              </div>
            </div>
          </div>
          <Alert className="border-warning/30 bg-warning/10 text-warning-foreground">
            <AlertCircleIcon aria-hidden="true" />
            <AlertDescription className="text-xs leading-relaxed text-warning-foreground">
              {t(
                'executorDownload.unsignedNotice',
                'This unsigned acceptance build has not completed public release validation.'
              )}
            </AlertDescription>
          </Alert>
          {primaryUrl ? (
            <a
              href={primaryUrl}
              className={cn(
                buttonVariants({ size: 'lg' }),
                'h-auto min-h-9 w-full py-2 text-center whitespace-normal'
              )}
            >
              <DownloadIcon data-icon="inline-start" aria-hidden="true" />
              {primaryLabel}
            </a>
          ) : (
            <div className="flex flex-col gap-2">
              <Button size="lg" className="h-auto min-h-9 py-2 text-center whitespace-normal" disabled>
                <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                {t('executorDownload.unavailable', 'Downloads are not available yet')}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(
                  'executorDownload.unavailableHint',
                  'Please check back when a download has been published.'
                )}
              </p>
            </div>
          )}
          {release.installerUrl && release.archiveUrl && (
            <a
              href={release.archiveUrl}
              className="self-center rounded-sm text-xs text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('executorDownload.archive', 'Download ZIP archive')}
            </a>
          )}
        </section>
        <Separator />
        <section className="flex flex-col gap-4">
          <h2 className="font-semibold">{t('executorDownload.setupTitle', 'Connect in three steps')}</h2>
          <ol className="flex flex-col gap-3">
            {steps.map((step, index) => (
              <li key={step} className="flex items-start gap-3 text-sm leading-relaxed">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        </section>
        <Separator />
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <a
            href={executorInstallationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'link' }), 'h-auto justify-start px-0 text-xs')}
          >
            <BookOpenIcon data-icon="inline-start" aria-hidden="true" />
            {t('executorDownload.guide', 'Installation and connection guide')}
          </a>
          <Link
            to="."
            search={(previous) => ({
              ...previous,
              executorDownload: undefined,
              settings: { path: '/settings/mcp' },
            })}
            mask={{ to: '/settings/mcp', search: {}, unmaskOnReload: true }}
            className={cn(buttonVariants({ variant: 'link' }), 'h-auto justify-start px-0 text-xs')}
          >
            <SettingsIcon data-icon="inline-start" aria-hidden="true" />
            {t('executorDownload.mcpSettings', 'Open MCP settings')}
          </Link>
        </div>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('executorDownload.browserHint', 'Browser tools require the companion browser extension.')}
        </p>
      </DialogContent>
    </Dialog>
  );
}
