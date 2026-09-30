/**
 * @author Codex
 * @description Renders Turn-owned auto-retry episodes with live progress, terminal outcomes, and cancellation.
 */

import { useState } from 'react';
import { CircleCheckIcon, CircleXIcon, RefreshCwIcon, SquareIcon } from 'lucide-react';
import { useInterval } from 'ahooks';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from 'zustand';
import { useI18n } from '@/i18n/use-i18n';
import { cn } from '@octopus/ui/lib/utils';
import { formatRetryTitle } from './utils/retry-presentation';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import { useRealtimeCommand } from '@/hooks/use-realtime';
import { sessionStores } from '@/stores/session';
import type { AutoRetryProjection } from '@/stores/session';

/**
 * Renders every retry episode owned by one Turn without subscribing the transcript shell to retry updates.
 *
 * @param props Session and Turn identities.
 * @returns Retry notices in chronological order, or nothing when the Turn never retried.
 */
export function RetryMarker({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const store = sessionStores.ensure(sessionId);
  const retries = useStore(store, (state) => state.turnsById[turnId]?.retries);
  const activeRetryId = useStore(store, (state) => state.activeRetryId);
  const runtimeId = useStore(store, (state) => state.runtimeId);
  const epoch = useStore(store, (state) => state.epoch);
  if (retries === undefined || retries.length === 0) {
    return null;
  }
  return (
    <div className="my-2 flex flex-col gap-2">
      {retries.map((retry) => (
        <RetryNotice
          key={`${retry.id}:${String(retry.attempt)}:${retry.status}`}
          active={retry.id === activeRetryId}
          epoch={epoch}
          retry={retry}
          runtimeId={runtimeId}
          sessionId={sessionId}
        />
      ))}
    </div>
  );
}

/**
 * Presents one retry episode and exposes cancellation only during Pi's abortable backoff wait.
 *
 * @param props Retry state and exact runtime-generation target.
 * @returns A compact status alert for the episode.
 */
function RetryNotice({
  active,
  epoch,
  retry,
  runtimeId,
  sessionId,
}: {
  active: boolean;
  epoch?: number;
  retry: AutoRetryProjection;
  runtimeId?: string;
  sessionId: string;
}) {
  const store = sessionStores.ensure(sessionId);
  const send = useRealtimeCommand();
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now);
  const [stopping, setStopping] = useState(false);
  const waiting = retry.status === 'waiting';
  useInterval(() => setNow(Date.now()), waiting ? 1_000 : undefined, { immediate: true });
  const title = formatRetryTitle(retry, now, t);
  const failed = retry.status === 'failed';
  let detail: string | undefined;
  if (failed) {
    detail = retry.finalError ?? retry.errorMessage;
  } else if (retry.status === 'succeeded') {
    detail = undefined;
  } else {
    detail = retry.errorMessage;
  }
  let tone = 'bg-muted/30';
  let iconTone = 'bg-muted text-muted-foreground';
  if (failed) {
    tone = 'border-destructive/20 bg-destructive/5';
    iconTone = 'bg-destructive/10 text-destructive';
  } else if (retry.status === 'succeeded') {
    tone = 'border-success/20 bg-success/5';
    iconTone = 'bg-success/10 text-success';
  }
  let Icon;
  if (failed) {
    Icon = CircleXIcon;
  } else if (retry.status === 'succeeded') {
    Icon = CircleCheckIcon;
  } else {
    Icon = RefreshCwIcon;
  }

  /**
   * Sends the existing fenced abort-retry command and prevents duplicate clicks while awaiting its events.
   */
  function stopRetry(): void {
    if (!active || !waiting || stopping) {
      return;
    }
    setStopping(true);
    try {
      send({
        type: 'agent.abort-retry',
        requestId: uuidv4(),
        sessionId,
        runtimeId,
        epoch,
      });
    } catch (error) {
      setStopping(false);
      store
        .getState()
        .setError(
          error instanceof Error ? error.message : t('session.retry.stopFailed', 'Could not stop retry.')
        );
    }
  }

  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={cn('flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-xs', tone)}
    >
      <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full', iconTone)}>
        <Icon
          aria-hidden
          className={cn(
            'size-3.5',
            active && (waiting || retry.status === 'retrying') && 'motion-safe:animate-spin'
          )}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <p className="wrap-anywhere">{title}</p>
        {detail !== undefined && (
          <p className="max-h-32 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground wrap-anywhere">
            {detail}
          </p>
        )}
        {active && waiting && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" disabled={stopping} onClick={stopRetry}>
              {stopping ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SquareIcon data-icon="inline-start" fill="currentColor" />
              )}
              {stopping ? t('session.retry.stopping', 'Stopping…') : t('session.retry.stop', 'Stop retry')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
