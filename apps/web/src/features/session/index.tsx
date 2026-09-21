/**
 * @author Codex
 * @description Exports the complete Session route with transcript, composer, activity, and extension UI.
 */

import { useParams } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@octopus/ui/components/empty';
import { useSessionRuntime } from '@/queries/realtime-queries';
import { useSessions } from '@/queries/workbench-queries';
import { useI18n } from '@/i18n/use-i18n';
import { sessionStores } from '@/stores/session';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { SubagentFleetPanel } from './SubagentFleetPanel';
import { BackgroundTasksPanel } from './BackgroundTasksPanel';
import { MemoryAssistant } from './MemoryAssistant';
import { GoalPanel } from './GoalPanel';
import { SessionErrorAlert } from './SessionErrorAlert';
import { SessionFocus } from './SessionFocus';
import { SessionSchedulerAlert } from './SessionSchedulerAlert';
import { ExecutionSession } from './ExecutionSession';
import { SessionConfigAlert } from './SessionConfigAlert';
import { SessionConnectingAlert } from './SessionConnectingAlert';
import { useMutationState, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sessionHistoryQueryOptions } from '@/queries/session-queries';

/**
 * Opens one Session projection without owning shared Layout chrome.
 */
export function WorkbenchSessionPage() {
  const { workspaceId, sessionId } = useParams({ strict: false }) as {
    workspaceId: string;
    sessionId: string;
  };
  return <SessionPageContent key={sessionId} workspaceId={workspaceId} sessionId={sessionId} />;
}

/**
 * Owns one keyed route activation so warm-projection decisions cannot leak across Session parameters.
 */
function SessionPageContent({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
  const { t } = useI18n();
  const sessions = useSessions(workspaceId);
  const session = sessions.data?.find((candidate) => candidate.id === sessionId);
  if (!session) {
    return (
      <p className="p-5 text-center text-sm text-muted-foreground">
        {sessions.isPending
          ? t('session.loading', 'Loading session…')
          : t('session.notFound', 'Session not found')}
      </p>
    );
  }
  return session.execution ? (
    <ExecutionSession session={session} />
  ) : (
    <InteractiveSession workspaceId={workspaceId} sessionId={sessionId} />
  );
}

/**
 * Activate only ordinary interactive conversations; Scheduler history never enters this component.
 */
function InteractiveSession({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
  const { t } = useI18n();
  const pendingRestarts = useMutationState({
    filters: { mutationKey: ['session-restart'], status: 'pending' },
    select: (mutation) => (mutation.state.variables as { session: { id: string } }).session.id,
  });
  const sessions = useSessions(workspaceId);
  const session = sessions.data?.find((candidate) => candidate.id === sessionId);
  const store = sessionStores.ensure(sessionId);
  const runtime = useSessionRuntime(workspaceId, sessionId);
  const history = useQuery({
    ...sessionHistoryQueryOptions(workspaceId, sessionId),
    enabled: !runtime.identityMatches,
  });
  useEffect(() => {
    if (history.data !== undefined) {
      store.getState().previewHistory(history.data);
    }
  }, [history.data, history.dataUpdatedAt, store]);
  const restarting =
    pendingRestarts.includes(sessionId) || session?.runtimeControl?.restart.status === 'restarting';
  const bootstrapReadiness = runtime.currentBootstrap?.readiness;
  const sessionReady = useStore(
    store,
    (state) =>
      !restarting &&
      state.loadState === 'ready' &&
      runtime.identityMatches &&
      bootstrapReadiness?.ready === true &&
      state.runtimeId === bootstrapReadiness.runtimeId &&
      state.epoch === bootstrapReadiness.epoch
  );

  if (!session) {
    return (
      <Empty className="h-full min-h-96">
        <EmptyHeader>
          <EmptyTitle>
            {sessions.isLoading
              ? t('session.loading', 'Loading session…')
              : t('session.notFound', 'Session not found')}
          </EmptyTitle>
          <EmptyDescription>
            {sessions.isLoading
              ? t('session.loadingDescription', 'Synchronizing the selected workspace.')
              : t('session.notFoundDescription', 'Choose another session from the sidebar.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col gap-2.5">
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 mx-auto flex w-full max-w-4xl flex-col gap-2">
        <SessionConfigAlert session={session} />
        <SessionErrorAlert
          sessionId={sessionId}
          runtimeError={runtime.query.error?.message}
          onRetry={runtime.query.refetch}
        />
        <SessionSchedulerAlert session={session} ready={sessionReady} />
        <SessionConnectingAlert
          visible={
            !sessionReady &&
            !runtime.query.error &&
            !restarting &&
            session.runtimeControl?.restart.status !== 'failed'
          }
        />
      </div>
      <SessionFocus sessionId={sessionId} />
      <Conversation loading={runtime.loading || !sessionReady} session={session} sessionId={session.id} />
      <MemoryAssistant sessionId={session.id} />
      <GoalPanel sessionId={session.id} />
      <SubagentFleetPanel sessionId={session.id} />
      <BackgroundTasksPanel sessionId={session.id} />
      <Composer
        commands={runtime.currentBootstrap?.commands ?? []}
        disabled={!sessionReady || session.runtimeControl?.restart.error?.retryable === false}
        models={runtime.currentBootstrap?.models ?? []}
        session={session}
      />
    </section>
  );
}
