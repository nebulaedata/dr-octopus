/**
 * @author Codex
 * @description Renders Turn-owned auto-retry episodes with live progress, terminal outcomes, and cancellation.
 */

import { useState } from 'react';
import { CircleCheckIcon, CircleXIcon, RefreshCwIcon, SquareIcon } from 'lucide-react';
import { useInterval } from 'ahooks';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from 'zustand';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
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
  const [now, setNow] = useState(Date.now);
  const [stopping, setStopping] = useState(false);
  const waiting = retry.status === 'waiting';
  useInterval(() => setNow(Date.now()), waiting ? 1_000 : undefined, { immediate: true });
  const title = formatRetryTitle(retry, now);
  const failed = retry.status === 'failed';
  let detail: string | undefined;
  if (failed) {
    detail = retry.finalError ?? retry.errorMessage;
  } else if (retry.status === 'succeeded') {
    detail = undefined;
  } else {
    detail = retry.errorMessage;
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
      store.getState().setError(error instanceof Error ? error.message : 'Could not stop retry.');
    }
  }

  return (
    <Alert variant={failed ? 'destructive' : 'default'}>
      <Icon className={active ? 'animate-spin' : undefined} />
      <AlertTitle>{title}</AlertTitle>
      {detail !== undefined || (active && waiting) ? (
        <AlertDescription className="flex items-start justify-between gap-3">
          {detail === undefined ? null : <span className="min-w-0 wrap-break-word">{detail}</span>}
          {active && waiting ? (
            <Button variant="destructive" size="sm" disabled={stopping} onClick={stopRetry}>
              {stopping ? <Spinner /> : <SquareIcon fill="currentColor" />}
              {stopping ? 'Stopping…' : 'Stop retry'}
            </Button>
          ) : null}
        </AlertDescription>
      ) : null}
    </Alert>
  );
}

/**
 * Formats retry counts according to Pi semantics, where attempt counts retries after the initial request.
 *
 * @param retry Retry episode to describe.
 * @param now Current browser time used for the backoff countdown.
 * @returns Concise user-facing retry status.
 */
function formatRetryTitle(retry: AutoRetryProjection, now: number): string {
  if (retry.status === 'succeeded') {
    return `Recovered after ${String(retry.attempt)} ${retry.attempt === 1 ? 'retry' : 'retries'}`;
  }
  if (retry.status === 'failed') {
    return `Retry failed after ${String(retry.attempt)} ${retry.attempt === 1 ? 'retry' : 'retries'}`;
  }
  const progress =
    retry.maxAttempts === undefined
      ? `Retry ${String(retry.attempt)}`
      : `Retry ${String(retry.attempt)} of ${String(retry.maxAttempts)}`;
  if (retry.status === 'retrying') {
    return `${progress} in progress…`;
  }
  const remainingSeconds = Math.max(0, Math.ceil((retry.scheduledAt + (retry.delayMs ?? 0) - now) / 1_000));
  return `${progress} in ${String(remainingSeconds)}s…`;
}
