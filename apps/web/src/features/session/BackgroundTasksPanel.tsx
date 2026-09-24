/**
 * @author Codex
 * @description Connects managed session processes to the task drawer and verified controls.
 */
import { useStore } from 'zustand';
import { sessionStores } from '@/stores/session';
import { BackgroundTasksView } from './BackgroundTasks/BackgroundTasksView';
import { useBackgroundTaskControl } from '@/features/session/hooks/use-background-task-control';

/**
 * Keeps runtime ownership outside presentation; closing the drawer never stops background work.
 */
export function BackgroundTasksPanel({ sessionId }: { sessionId: string }) {
  const snapshot = useStore(sessionStores.ensure(sessionId), (state) => state.backgroundTasks);
  const control = useBackgroundTaskControl(sessionId);
  return (
    <BackgroundTasksView
      key={`${sessionId}:${snapshot?.generation ?? 'unavailable'}`}
      sessionId={sessionId}
      snapshot={snapshot}
      onAction={control}
    />
  );
}
