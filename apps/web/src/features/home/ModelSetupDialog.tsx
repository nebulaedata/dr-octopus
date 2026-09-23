/**
 * @author Codex
 * @description Guides missing-model recovery with dismissible, draft-preserving configuration and selection actions.
 */
import { useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  ArrowRightIcon,
  BotIcon,
  CloudIcon,
  LaptopIcon,
  RefreshCwIcon,
  SquareMousePointerIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { useI18n } from '@/i18n/use-i18n';

export interface ModelSetupDialogProps {
  issue: 'empty' | 'selection' | 'error' | null;
  requestVersion: number;
  refreshing: boolean;
  /**
   * Opens the existing Composer model selector after closing guidance.
   */
  onChooseModel(): void;
  /**
   * Reloads the model directory without creating a conversation.
   */
  onRetry(): void;
}

/**
 * Prompts once per issue and explicit retry intent, without interrupting an open Settings dialog.
 */
export function ModelSetupDialog({
  issue,
  requestVersion,
  refreshing,
  onChooseModel,
  onRetry,
}: ModelSetupDialogProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const settingsOpen = useSearch({ strict: false, select: (search) => Boolean(search.settings) });
  const [dismissed, setDismissed] = useState('');
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const token = `${issue}:${requestVersion}`;
  const open = issue !== null && dismissed !== token && !settingsOpen;
  let title = t('home.modelSetup.title', 'Connect a model to get started');
  let description = t(
    'home.modelSetup.description',
    'Add a model service so Dr.Octopus can help with your next task.'
  );
  if (issue === 'error') {
    title = t('home.modelSetup.errorTitle', 'Could not load your models');
    description = t(
      'home.modelSetup.errorDescription',
      'Check your connection and try again, or review your model settings.'
    );
  } else if (issue === 'selection') {
    title = t('home.modelSetup.selectTitle', 'Choose an available model');
    description = t(
      'home.modelSetup.selectDescription',
      'Set a default model for new sessions, or choose a model just for this session.'
    );
  }
  /**
   * Reuses the route-masked Settings surface while retaining the mounted home draft.
   */
  function configure(): void {
    setDismissed(token);
    const path = issue === 'selection' ? '/settings/default-model' : '/settings/model-providers';
    void navigate({
      to: '.',
      search: (previous) => ({ ...previous, settings: { path } }),
      mask: { to: path, search: {}, unmaskOnReload: true },
    });
  }
  /**
   * Moves from guidance to the model menu without leaving the draft.
   */
  function choose(): void {
    setDismissed(token);
    onChooseModel();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDismissed(token);
        }
      }}
    >
      <DialogContent
        initialFocus={primaryActionRef}
        className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto p-6 sm:max-w-md"
      >
        <DialogHeader className="gap-3 pr-5">
          <DialogTitle className="text-xl leading-snug flex items-center gap-2">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BotIcon className="size-6" aria-hidden="true" />
            </div>
            {title}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">{description}</DialogDescription>
        </DialogHeader>
        {issue === 'empty' && (
          <div className="flex flex-col gap-4 rounded-xl bg-muted/50 p-4">
            <div className="flex items-start gap-3">
              <CloudIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('home.modelSetup.cloud', 'Cloud models')}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {t('home.modelSetup.cloudDescription', 'Connect a provider with your API key or account.')}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <LaptopIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('home.modelSetup.local', 'Local models')}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {t('home.modelSetup.localDescription', 'Use Ollama, LM Studio, or another local service.')}
                </span>
              </div>
            </div>
          </div>
        )}
        {(issue === 'selection' || issue === 'error') && (
          <Button
            variant="outline"
            size="lg"
            className="justify-start"
            onClick={issue === 'selection' ? choose : configure}
          >
            <SquareMousePointerIcon />
            {issue === 'selection'
              ? t('home.modelSetup.choose', 'Choose model')
              : t('home.configureModels', 'Configure model services')}
            <ArrowRightIcon className="ml-auto text-muted-foreground" data-icon="inline-end" />
          </Button>
        )}
        <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
          <Button variant="ghost" onClick={() => setDismissed(token)}>
            {t('home.modelSetup.later', 'Not now')}
          </Button>
          {issue === 'error' ? (
            <Button ref={primaryActionRef} disabled={refreshing} onClick={onRetry}>
              <RefreshCwIcon data-icon="inline-start" />
              {t('common.retry', 'Retry')}
            </Button>
          ) : (
            <Button ref={primaryActionRef} onClick={configure}>
              {issue === 'selection'
                ? t('home.modelSetup.configureDefault', 'Set default model')
                : t('home.modelSetup.configure', 'Set up a model')}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
