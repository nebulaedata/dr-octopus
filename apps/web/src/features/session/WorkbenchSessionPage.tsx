/**
 * @author Codex
 * @description Exports the complete Session route with transcript, composer, activity, and extension UI.
 */

import { useParams } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { useSessionRuntime } from '@/queries/realtime-queries';
import { useSessions } from '@/queries/workbench-queries';
import { useI18n } from '@/i18n/use-i18n';
import { sessionStores } from '@/stores/session';
import { Composer } from '@/features/session/Composer';
import { Conversation } from '@/features/session/Conversation';
import { SubagentFleetPanel } from '@/features/session/SubagentFleetPanel';
import { BackgroundTasksPanel } from '@/features/session/BackgroundTasksPanel';
import { MemoryAssistant } from '@/features/session/MemoryAssistant/MemoryAssistant';
import { GoalPanel } from '@/features/session/GoalPanel';
import { SessionErrorAlert } from '@/features/session/SessionErrorAlert';
import { SessionFocus } from '@/features/session/SessionFocus';
import { SessionSchedulerAlert } from '@/features/session/SessionSchedulerAlert';
import { ExecutionSession } from '@/features/session/ExecutionSession';
import { useSessionStart } from '@/features/session/hooks/use-session-start';
import { SessionStartReceipt } from '@/features/session/SessionStartReceipt';
import { SessionConfigAlert } from '@/features/session/SessionConfigAlert';
import { SessionConnectingAlert } from '@/features/session/SessionConnectingAlert';
import { useMutationState, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sessionHistoryQueryOptions } from '@/queries/session-queries';
import type { ReactNode } from 'react';
import type { SessionDto, ConversationStartDto } from '@octopus/shared/protocol';

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
  const startup = useSessionStart(workspaceId, sessionId, session === undefined);
  const startAlert = (
    <>
      <SessionStartReceipt startup={startup} />
      {!session && (
        <SessionErrorAlert
          sessionId={sessionId}
          runtimeError={sessions.error?.message}
          onRetry={sessions.refetch}
        />
      )}
    </>
  );
  const starting = ['preparing', 'accepted', 'dispatching'].includes(startup.receipt.data?.status ?? '');
  if (
    !session &&
    (!startup.receipt.data ||
      (startup.receipt.data.status === 'running' &&
        sessions.dataUpdatedAt >= startup.receipt.dataUpdatedAt)) &&
    !startup.receipt.isError &&
    !startup.receipt.isPending &&
    !sessions.isPending &&
    !sessions.isFetching &&
    !sessions.isError
  ) {
    return (
      <p className="p-5 text-center text-sm text-muted-foreground">
        {t('session.notFound', 'Session not found')}
      </p>
    );
  }
  // Presentation metadata only: publication still gates every Agent-facing operation.
  const viewSession: SessionDto = session ?? {
    id: sessionId,
    workspaceId,
    title: t('session.newSession', 'New session'),
    isDraft: true,
    createdAt: '',
    updatedAt: '',
    preferences: {
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      autoCompactionEnabled: true,
      autoRetryEnabled: true,
    },
  };
  return session?.execution ? (
    <ExecutionSession session={session} />
  ) : (
    <InteractiveSession
      session={viewSession}
      published={session !== undefined}
      startAlert={startAlert}
      starting={starting}
      showConnecting={
        !startup.receipt.isError && (!startup.receipt.data || startup.receipt.data.status === 'running')
      }
      savedMessage={startup.receipt.data}
    />
  );
}

/**
 * Keeps one transcript and Composer mounted from preparation through runtime activation.
 */
function InteractiveSession({
  session,
  published,
  startAlert,
  starting,
  showConnecting,
  savedMessage,
}: {
  session: SessionDto;
  published: boolean;
  startAlert: ReactNode;
  starting: boolean;
  showConnecting: boolean;
  savedMessage?: ConversationStartDto | null;
}) {
  const { workspaceId, id: sessionId } = session;
  const pendingRestarts = useMutationState({
    filters: { mutationKey: ['session-restart'], status: 'pending' },
    select: (mutation) => (mutation.state.variables as { session: { id: string } }).session.id,
  });
  const store = sessionStores.ensure(sessionId);
  const runtime = useSessionRuntime(workspaceId, sessionId, published);
  const history = useQuery({
    ...sessionHistoryQueryOptions(workspaceId, sessionId),
    enabled: published && !runtime.identityMatches,
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
      published &&
      !restarting &&
      state.loadState === 'ready' &&
      runtime.identityMatches &&
      bootstrapReadiness?.ready === true &&
      state.runtimeId === bootstrapReadiness.runtimeId &&
      state.epoch === bootstrapReadiness.epoch
  );

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col gap-2.5">
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 mx-auto flex w-full max-w-4xl flex-col gap-2">
        {startAlert}
        {published && <SessionConfigAlert session={session} />}
        <SessionErrorAlert
          sessionId={sessionId}
          runtimeError={runtime.query.error?.message}
          onRetry={runtime.query.refetch}
        />
        {published && <SessionSchedulerAlert session={session} ready={sessionReady} />}
        <SessionConnectingAlert
          visible={
            showConnecting &&
            !sessionReady &&
            !runtime.query.error &&
            !restarting &&
            session.runtimeControl?.restart.status !== 'failed'
          }
        />
      </div>
      {published && <SessionFocus sessionId={sessionId} />}
      <Conversation
        loading={runtime.loading || !sessionReady}
        session={session}
        sessionId={session.id}
        savedMessage={savedMessage}
      />
      {published && (
        <>
          <MemoryAssistant sessionId={session.id} />
          <GoalPanel sessionId={session.id} />
          <SubagentFleetPanel sessionId={session.id} />
          <BackgroundTasksPanel sessionId={session.id} />
        </>
      )}
      <Composer
        commands={runtime.currentBootstrap?.commands ?? []}
        connecting={starting || (showConnecting && !sessionReady && !runtime.query.error)}
        submitDisabled={
          starting || !sessionReady || session.runtimeControl?.restart.error?.retryable === false
        }
        models={runtime.currentBootstrap?.models ?? []}
        session={session}
      />
    </section>
  );
}
