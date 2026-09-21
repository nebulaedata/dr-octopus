/**
 * @author Codex
 * @description Displays bounded task output with explicit refresh, loading and copy feedback.
 */
import { copyText } from '@/lib/clipboard';
import { useSafeState } from 'ahooks';
import { CheckIcon, CopyIcon, LoaderCircleIcon, RefreshCwIcon, TerminalIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { useI18n } from '@/i18n/use-i18n';
import type { BackgroundTasksSnapshot } from '@octopus/shared/protocol';

interface BackgroundTaskLogsProps {
  id: string;
  logs?: BackgroundTasksSnapshot['logs'];
  loading: boolean;
  disabled: boolean;
  /**
   * Requests fresh output for the currently expanded task.
   */
  onRefresh(): void;
}

/**
 * Keeps output inside its task, with no stale logs from another selection.
 */
export function BackgroundTaskLogs({ id, logs, loading, disabled, onRefresh }: BackgroundTaskLogsProps) {
  const { t } = useI18n();
  const [copiedText, setCopiedText] = useSafeState<string>();
  const [copyError, setCopyError] = useSafeState(false);
  const copied = logs?.text !== undefined && logs.text === copiedText;
  /**
   * Copies the displayed snapshot and reports clipboard failures without losing output.
   */
  async function copy(): Promise<void> {
    try {
      await copyText(logs?.text ?? '');
      setCopiedText(logs?.text);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div
      id={id}
      aria-label="Task logs"
      aria-busy={loading}
      className="mx-3 mb-3 overflow-hidden rounded-lg border bg-muted/30"
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <TerminalIcon className="size-3.5" />
          {t('session.backgroundTasks.logs.recentOutput', 'Recent output')}
          {logs?.truncated && t('session.backgroundTasks.logs.truncatedSuffix', ' · truncated')}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={disabled || loading}
            onClick={onRefresh}
            aria-label="Refresh logs"
            title={t('session.backgroundTasks.logs.refresh', 'Refresh logs')}
          >
            <RefreshCwIcon className={loading ? 'motion-safe:animate-spin' : undefined} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!logs?.text || loading}
            onClick={() => void copy()}
            aria-label={copied ? 'Logs copied' : 'Copy logs'}
            title={
              copied
                ? t('session.backgroundTasks.logs.copied', 'Copied')
                : t('session.backgroundTasks.logs.copy', 'Copy logs')
            }
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </div>
      {loading ? (
        <div
          role="status"
          className="flex min-h-28 items-center justify-center gap-2 text-xs text-muted-foreground"
        >
          <LoaderCircleIcon className="size-3.5 motion-safe:animate-spin" />
          {t('session.backgroundTasks.logs.loading', 'Reading logs…')}
        </div>
      ) : logs?.text ? (
        <pre
          tabIndex={0}
          className="max-h-64 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-6"
        >
          {logs.text}
        </pre>
      ) : (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
          {logs
            ? t('session.backgroundTasks.logs.empty', 'No output from this task yet')
            : t('session.backgroundTasks.logs.notLoaded', 'Logs not loaded; click refresh to retry')}
        </p>
      )}
      {copyError && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {t(
            'session.backgroundTasks.logs.copyFailed',
            'Unable to copy; select the log text and copy it manually.'
          )}
        </p>
      )}
    </div>
  );
}
