/**
 * @author Codex
 * @description Knowledge model settings and shared daemon lifecycle inside the existing Settings frame.
 */
import { SettingContainer } from '../Layout/SettingContainer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseIcon, PlayIcon, SquareIcon, RotateCwIcon } from 'lucide-react';
import { Card, CardContent } from '@octopus/ui/components/card';
import { Button } from '@octopus/ui/components/button';
import { Spinner } from '@octopus/ui/components/spinner';
import { Empty, EmptyHeader, EmptyDescription } from '@octopus/ui/components/empty';
import { Badge } from '@octopus/ui/components/badge';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { getKnowledgeModels, knowledgeService } from '@/api/knowledge';
import { useI18n } from '@/i18n/use-i18n';
import { KnowledgeModelCard } from './KnowledgeModelCard';
import { KnowledgeSharingCard } from './KnowledgeSharingCard';
import { KnowledgeMountsCard } from './KnowledgeMountsCard';
import { cn } from '@octopus/ui/lib/utils';

/**
 * Observe first and offer explicit start when stop suppression is active.
 */
export function KnowledgeSettingsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const service = useQuery({
    queryKey: ['knowledge', 'service'],
    queryFn: ({ signal }) => knowledgeService('status', signal),
  });
  const models = useQuery({
    queryKey: ['knowledge', 'models'],
    queryFn: ({ signal }) => getKnowledgeModels(signal),
    enabled: service.data?.state === 'running',
  });
  const lifecycle = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => knowledgeService(action),
    onSuccess: (value) => {
      queryClient.setQueryData(['knowledge', 'service'], value);
    },
  });
  const active = service.data?.state === 'running';
  const pendingAction = lifecycle.isPending ? lifecycle.variables : undefined;
  const changingState = pendingAction === 'start' || pendingAction === 'stop';
  const restarting = pendingAction === 'restart';
  /**
   * Selects button content in the existing condition order.
   */
  function renderButtonContent() {
    if (changingState) {
      if (pendingAction === 'start') {
        return t('settings.knowledge.service.starting', 'Starting…');
      } else {
        return t('settings.knowledge.service.stopping', 'Stopping…');
      }
    } else if (active) {
      return t('settings.knowledge.service.stop', 'Stop');
    } else {
      return t('settings.knowledge.service.start', 'Start');
    }
  }
  /**
   * Selects button content2 in the existing condition order.
   */
  function renderButtonContent2() {
    if (changingState) {
      return <Spinner data-icon="inline-start" aria-label="Action in progress" />;
    } else if (active) {
      return <SquareIcon data-icon="inline-start" />;
    } else {
      return <PlayIcon data-icon="inline-start" />;
    }
  }
  /**
   * Selects badge content in the existing condition order.
   */
  function renderBadgeContent() {
    if (active) {
      return t('settings.knowledge.service.state.running', 'Running');
    } else if (service.data?.state === 'stopped') {
      return t('settings.knowledge.service.state.stopped', 'Stopped');
    } else {
      return t('settings.knowledge.service.state.notStarted', 'Not started');
    }
  }
  return (
    <SettingContainer>
      <Card className="shrink-0 shadow-none">
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="rounded-xl bg-primary/8 p-3">
            <DatabaseIcon className="size-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              {t('settings.knowledge.service.title', 'Knowledge service')}
              <Badge
                variant="secondary"
                className={cn(active ? 'bg-success text-white' : 'text-muted-foreground')}
              >
                {renderBadgeContent()}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                'settings.knowledge.service.description',
                'All workspaces share one background service; once stopped it must be started manually.'
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={active ? 'destructive' : 'default'}
              size="sm"
              disabled={lifecycle.isPending}
              aria-busy={changingState}
              onClick={() => lifecycle.mutate(active ? 'stop' : 'start')}
            >
              {renderButtonContent2()}
              {renderButtonContent()}
            </Button>
            {active || restarting ? (
              <Button
                variant="default"
                size="sm"
                aria-label={restarting ? 'Restarting knowledge service' : 'Restart knowledge service'}
                aria-busy={restarting}
                disabled={lifecycle.isPending}
                onClick={() => lifecycle.mutate('restart')}
              >
                {restarting ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RotateCwIcon data-icon="inline-start" />
                )}
                {t('settings.knowledge.service.restart', 'Restart')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {service.error || models.error || lifecycle.error ? (
        <Alert variant="destructive">
          <AlertDescription>{(lifecycle.error ?? models.error ?? service.error)?.message}</AlertDescription>
        </Alert>
      ) : null}
      {models.data && active ? (
        (['embedding', 'ocr', 'reranker'] as const).map((kind) => (
          <KnowledgeModelCard
            key={kind + JSON.stringify(models.data![kind])}
            kind={kind}
            models={models.data!}
          />
        ))
      ) : (
        <Empty className="flex-none border p-8">
          <EmptyHeader>
            <EmptyDescription>
              {active
                ? t('settings.knowledge.models.loading', 'Loading model configuration…')
                : t(
                    'settings.knowledge.models.startHint',
                    'Start the knowledge service to configure models. Intranet models need no API Key.'
                  )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {active ? (
        <>
          <KnowledgeSharingCard />
          <KnowledgeMountsCard />
        </>
      ) : null}
    </SettingContainer>
  );
}
