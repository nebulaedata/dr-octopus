/**
 * @author Codex
 * @description Displays one turn's elapsed time and accumulated prompt/completion tokens.
 */

import { ArrowDownIcon, ArrowUpIcon, Clock3Icon } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { formatTokenCount, selectTurnTokenUsage } from '@/stores/session';
import { Marker, MarkerContent, MarkerIcon } from '@octopus/ui/components/marker';
import { selectTurnElapsedMs, sessionStores } from '@/stores/session';
import { useI18n } from '@/i18n/use-i18n';
import { ElapsedTime } from '@octopus/custom-ui/components/elapsed-time';
import { cn } from '@octopus/ui/lib/utils';
import { Spinner } from '@octopus/ui/components/spinner';
export interface TurnDurationMarkerProps {
  sessionId: string;
  turnId: string;
}

/**
 * Renders an active or completed duration from one explicit Turn projection.
 *
 * The ticking value comes from the shared ElapsedTime component: the store only
 * republishes the Server-clock snapshot when events arrive, while the component
 * interpolates locally at a one-second cadence, so no client wall clock ever
 * mixes into the Server time domain.
 *
 * @param props - Session and turn identities used to select elapsed time and token usage.
 * @returns A compact transcript marker, or nothing when the persisted start is unavailable.
 */
export function TurnDurationMarker({ sessionId, turnId }: TurnDurationMarkerProps) {
  const { t } = useI18n();
  const store = sessionStores.ensure(sessionId);
  const turn = useStore(store, (state) => state.turnsById[turnId]);
  const elapsedMs = useStore(store, (state) => selectTurnElapsedMs(state, turnId));
  const usage = useStore(
    store,
    useShallow((state) => selectTurnTokenUsage(state, turnId))
  );
  const active = turn?.status === 'running';
  if (turn === undefined || elapsedMs === undefined || (!active && turn.endedAt === undefined)) {
    return null;
  }
  return (
    <Marker role="status" className={cn('my-2', active && 'shimmer')} variant="separator">
      <MarkerIcon>{active ? <Spinner /> : <Clock3Icon />}</MarkerIcon>
      <MarkerContent className="text-xs tabular-nums font-geist flex gap-2">
        {active
          ? t('session.turnDuration.processing', 'Processing')
          : t('session.turnDuration.processed', 'Processed')}
        <ElapsedTime key={turnId} elapsedMs={elapsedMs} running={active} refreshMs={1000} format="compact" />
        {usage !== undefined && (
          <span
            className="flex gap-2 flex-nowrap items-center"
            title={t(
              'session.turnDuration.usageTitle',
              'Prompt: {{input}} tokens; Completion: {{output}} tokens',
              {
                input: usage.input.toLocaleString('en'),
                output: usage.output.toLocaleString('en'),
              }
            )}
          >
            <span className="flex items-center gap-0.5">
              <ArrowUpIcon className="size-3" />
              {formatTokenCount(usage.input)}
            </span>
            <span>{'•'}</span>
            <span className="flex items-center gap-0.5">
              <ArrowDownIcon className="size-3" />
              {formatTokenCount(usage.output)}
            </span>
            <span>{t('session.turnDuration.tokens', 'tokens')}</span>
          </span>
        )}
      </MarkerContent>
    </Marker>
  );
}
