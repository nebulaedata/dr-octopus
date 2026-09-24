/**
 * @author Codex
 * @description Presents process-independent drafting, model selection and recoverable first-message submission.
 */
import { useState } from 'react';
import { Button } from '@octopus/ui/components/button';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { OctopusLogo } from '@/components/OctopusLogo';
import { Composer } from '@/features/session';
import { ModelSetupDialog } from './ModelSetupDialog';
import { useHomeDrafts } from '@/stores/home-drafts';
import { useWorkbenchHome } from '@/stores/workbench-home';
import { useI18n } from '@/i18n/use-i18n';
import { useHomeDraft } from '@/features/home/hooks/use-home-draft';

/**
 * Retains the existing local draft identity without prewarming a process.
 */
export function AgentHomePage({ workspaceId }: { workspaceId: string }) {
  return <HomeDraftHost key={workspaceId} workspaceId={workspaceId} />;
}

/**
 * Remounts only when the user explicitly separates a conflicting tab's draft.
 */
function HomeDraftHost({ workspaceId }: { workspaceId: string }) {
  const [id, setId] = useState(() => useWorkbenchHome.getState().ensureDraftId(workspaceId));
  return <HomeDraft key={id} id={id} workspaceId={workspaceId} onSeparate={setId} />;
}

/**
 * Keeps failed submissions recoverable across navigation and refresh.
 */
function HomeDraft({
  workspaceId,
  id,
  onSeparate,
}: {
  workspaceId: string;
  id: string;
  onSeparate: (id: string) => void;
}) {
  const { t } = useI18n();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const {
    draft,
    error,
    catalog,
    submission,
    operation,
    pending,
    models,
    selected,
    session,
    initialDraft,
    submit,
    post,
    separateDraft,
    conflict,
    modelSetupRequest,
    requestModelSetup,
  } = useHomeDraft(workspaceId, id, onSeparate);
  /**
   * Selects issue in the existing condition order.
   */
  function selectIssue() {
    if (pending) {
      return null;
    } else if (catalog.isError) {
      return 'error' as const;
    } else if (catalog.isSuccess && !selected) {
      if (models.length === 0) {
        return 'empty' as const;
      } else {
        return 'selection' as const;
      }
    } else {
      return null;
    }
  }
  return (
    <section aria-label="Agent home" className="flex h-full min-h-0 flex-col overflow-y-auto px-4 sm:px-8">
      <div className="mx-auto my-auto w-full max-w-180 py-12">
        <div className="mb-8 flex flex-col items-center gap-2">
          <OctopusLogo className="size-20 sm:size-24" loading={pending} />
          <h1 className="text-xl font-medium text-center sm:text-[28px] font-serif text-transparent bg-clip-text bg-linear-to-r from-red-600 via-indigo-600 to-amber-500 dark:from-red-400 dark:via-indigo-400">
            {t('home.readyTitle', "I'm Dr.Octopus — what would you like to do today?")}
          </h1>
        </div>
        <ModelSetupDialog
          issue={selectIssue()}
          requestVersion={modelSetupRequest}
          refreshing={catalog.isFetching}
          onRetry={() => void catalog.refetch()}
          onChooseModel={() => setModelMenuOpen(true)}
        />
        <Composer
          variant="home"
          session={session}
          commands={[]}
          models={models}
          modelMenuOpen={modelMenuOpen}
          onModelMenuOpenChange={setModelMenuOpen}
          onModelConfigurationNeeded={requestModelSetup}
          followDefaultModel={draft.selection.mode === 'follow-default'}
          onFollowDefaultModel={() => useHomeDrafts.getState().select(id, { mode: 'follow-default' })}
          initialDraft={initialDraft}
          draftControls={draft.controls}
          onDraftControlsChange={(controls) => useHomeDrafts.getState().controls(id, controls)}
          firstSubmitPending={pending}
          onDraftChange={(value) => useHomeDrafts.getState().edit(id, value)}
          onDraftModelChange={(value) => {
            const [provider, ...model] = value.split('/');
            useHomeDrafts
              .getState()
              .select(id, { mode: 'explicit', provider: provider!, modelId: model.join('/') });
          }}
          onFirstSubmit={submit}
        />
        {(error || operation.data?.error || operation.isError) && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>
              {error ??
                operation.data?.error ??
                t(
                  'home.statusUnavailable',
                  'Submission status is unavailable. Retry to check the same request.'
                )}
              {conflict && (
                <Button variant="outline" size="sm" onClick={separateDraft}>
                  {t('home.separateDraft', 'Keep input in a separate conversation')}
                </Button>
              )}
              {submission && operation.isError && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await post(submission);
                  }}
                >
                  {t('common.retry', 'Retry')}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  );
}
