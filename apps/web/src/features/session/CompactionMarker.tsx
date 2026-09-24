/**
 * @author Codex
 * @description Renders one manual or automatic context-compaction lifecycle in the transcript.
 */

import { ArchiveIcon, CircleAlertIcon, CheckIcon } from 'lucide-react';
import { useStore } from 'zustand';
import { Marker, MarkerContent, MarkerIcon } from '@octopus/ui/components/marker';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { sessionStores } from '@/stores/session';

/**
 * Subscribes to one compaction projection and presents its active or terminal state.
 *
 * @param props - Session and compaction identities.
 * @returns A separator marker describing the compaction result.
 */
export function CompactionMarker({ compactionId, sessionId }: { compactionId: string; sessionId: string }) {
  const compaction = useStore(
    sessionStores.ensure(sessionId),
    (state) => state.compactionsById[compactionId]
  );
  if (compaction === undefined) {
    return null;
  }
  const active = compaction.status === 'running';
  const automatic = compaction.reason !== 'manual';
  let label: string;
  if (compaction.status === 'error') {
    label = compaction.errorMessage ?? 'Compaction failed';
  } else if (compaction.status === 'aborted') {
    label = 'Compaction cancelled';
  } else if (active) {
    if (automatic) {
      label = 'Automatically compacting context';
    } else {
      label = 'Compacting context';
    }
  } else if (automatic) {
    label = 'Context automatically compacted';
  } else {
    label = 'Context compacted';
  }
  /**
   * Selects marker icon content in the existing condition order.
   */
  function renderMarkerIconContent() {
    if (active) {
      return <Spinner />;
    } else if (compaction.status === 'error' || compaction.status === 'aborted') {
      return <CircleAlertIcon />;
    } else {
      return <CheckIcon />;
    }
  }
  return (
    <Marker
      role="status"
      className={cn('my-2', active && 'shimmer', compaction.status === 'error' && 'text-destructive')}
      variant="separator"
    >
      <MarkerIcon>{renderMarkerIconContent()}</MarkerIcon>
      <MarkerContent className="text-xs">
        <span className="sr-only">{automatic ? 'Automatic compaction: ' : 'Compaction: '}</span>
        {label}
      </MarkerContent>
      {active && (
        <MarkerIcon>
          <ArchiveIcon />
        </MarkerIcon>
      )}
    </Marker>
  );
}
