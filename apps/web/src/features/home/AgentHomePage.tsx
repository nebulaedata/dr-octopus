/**
 * @author Codex
 * @description Presents the general agent landing page and prewarms a private draft before its first message.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { Button } from '@octopus/ui/components/button';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { OctopusLogo } from '@/components/OctopusLogo';
import { prepareSessionDraft } from '@/api/sessions';
import { ApiRequestError } from '@/utils/request';
import { queryKeys } from '@/queries/query-keys';
import { useSessionRuntime } from '@/queries/realtime-queries';
import { sessionStores } from '@/stores/session';
import { useWorkbenchHome } from '@/stores/workbench-home';
import { Composer } from '@/features/session/Composer';
import { useI18n } from '@/i18n/use-i18n';
import { Marker, MarkerContent } from '@octopus/ui/components/marker';
import { RotateCwIcon } from 'lucide-react';
import { cn } from '@octopus/ui/lib/utils';
import type { SessionDto } from '@octopus/shared/protocol';

/**
 * Keeps the current draft mounted when New session returns to the same workspace.
 */
export function AgentHomePage({ workspaceId }: { workspaceId: string }) {
  return <AgentHomeDraft key={workspaceId} workspaceId={workspaceId} />;
}

/**
 * Retains typed text during warmup and publishes only from the Composer's first-send path.
 */
function AgentHomeDraft({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [initialDraftId] = useState(() => useWorkbenchHome.getState().ensureDraftId(workspaceId));
  const draftId = useWorkbenchHome((state) => state.draftIds[workspaceId]) ?? initialDraftId;
  const [placeholderSession] = useState<SessionDto>(() => ({
    id: draftId,
    workspaceId,
    title: t('layout.sidebar.newSession', 'New session'),
    isDraft: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preferences: {
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      autoCompactionEnabled: true,
      autoRetryEnabled: true,
    },
  }));
  const navigate = useNavigate();
  const prepared = useQuery({
    queryKey: queryKeys.sessionDraft(workspaceId, draftId),
    queryFn: () => prepareSessionDraft(workspaceId, draftId),
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (prepared.error instanceof ApiRequestError && prepared.error.code === 'SESSION_DRAFT_EXPIRED') {
      const text = sessionStores.ensure(draftId).getState().draft;
      const nextId = useWorkbenchHome.getState().renewDraftId(workspaceId, draftId);
      const nextStore = sessionStores.ensure(nextId);
      if (nextStore.getState().draft === '') {
        nextStore.getState().setDraft(text);
      }
    }
  }, [prepared.error, workspaceId, draftId]);
  const runtime = useSessionRuntime(workspaceId, draftId, prepared.isSuccess);
  const store = sessionStores.ensure(draftId);
  const readiness = runtime.currentBootstrap?.readiness;
  const ready = useStore(
    store,
    (state) =>
      state.loadState === 'ready' &&
      runtime.identityMatches &&
      readiness?.ready === true &&
      state.runtimeId === readiness.runtimeId &&
      state.epoch === readiness.epoch
  );
  const projectionError = useStore(store, (state) => state.error);
  const error = prepared.error?.message ?? runtime.query.error?.message ?? projectionError;
  const loading = !ready && !error;
  const session = {
    ...runtime.currentBootstrap?.session,
    ...(prepared.data ?? { ...placeholderSession, id: draftId }),
  };

  return (
    <section
      aria-label="Agent home"
      className="flex h-full min-h-0 flex-col overflow-y-auto px-4 sm:px-8"
    >
      <div className="mx-auto my-auto w-full max-w-180 py-12 sm:-translate-y-5">
        <div className="mb-8 flex flex-col items-center gap-2 text-center sm:mb-9">
          <OctopusLogo className="size-20 sm:size-24" loading={loading} />

          {loading ? (
            <Marker role="status" className="flex flex-col">
              <MarkerContent className="shimmer">
                <h1 className="text-xl font-medium tracking-tight sm:text-[28px] font-serif">
                  {t('home.loadingTitle', "I'm Dr.Octopus, getting your agent ready!")}
                </h1>
              </MarkerContent>
            </Marker>
          ) : (
            <h1
              className={cn(
                'text-xl font-medium tracking-tight sm:text-[28px] font-serif',
                'text-transparent bg-clip-text bg-linear-to-r from-red-600 via-indigo-600 to-amber-500',
                'dark:from-red-400 dark:via-indigo-400'
              )}
            >
              {t('home.readyTitle', "I'm Dr.Octopus — what would you like to do today?")}
            </h1>
          )}
        </div>
        <Composer
          variant="home"
          session={session}
          disabled={!ready}
          placeholder={loading ? t('home.composerPlaceholder', 'Type a task while you wait…') : undefined}
          models={runtime.currentBootstrap?.models ?? []}
          commands={runtime.currentBootstrap?.commands ?? []}
          onPromptSubmitted={() => {
            useWorkbenchHome.getState().forgetDraft(workspaceId);
            void navigate({
              to: '/workspaces/$workspaceId/sessions/$sessionId',
              params: { workspaceId, sessionId: draftId },
              search: (previous) => previous,
            });
          }}
        />
        {error && (
          <Alert variant="destructive" className="mt-2 border-destructive/50 bg-destructive/5">
            <AlertDescription className="flex items-center justify-between gap-3">
              <span className="text-xs">{error}</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  store.getState().setError(undefined);
                  const result = await prepared.refetch();
                  if (result.isSuccess) {
                    await runtime.query.refetch();
                  }
                }}
              >
                <RotateCwIcon data-icon="inline-start" />
                {t('common.retry', 'Retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  );
}
