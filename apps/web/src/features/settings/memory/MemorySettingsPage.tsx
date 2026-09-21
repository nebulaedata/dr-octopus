/**
 * @author Codex
 * @description Configures the shared memory policy inside canonical and dialog Settings surfaces.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { ToggleGroup, ToggleGroupItem } from '@octopus/ui/components/toggle-group';
import { setMemoryPolicy, memoryService } from '@/api/memory';
import { memoryQueryKey, memoryStatusQuery, memoryServiceQuery } from '@/queries/memory-queries';
import { useI18n } from '@/i18n/use-i18n';
import { MemoryServiceCard } from './MemoryServiceCard';
import { SettingContainer } from '../layout/SettingContainer';
import { CircleXIcon, HandIcon, LoaderPinwheelIcon } from 'lucide-react';
import type { MemoryMode } from '@octopus/shared/protocol/memory';

/**
 * Persist each selection immediately and refresh authoritative state after success or conflict.
 */
export function MemorySettingsPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const service = useQuery(memoryServiceQuery());
  const active = service.data?.state === 'running';
  const lifecycle = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') => memoryService(action),
    onSuccess: (value) => client.setQueryData(memoryServiceQuery().queryKey, value),
    onSettled: () => client.invalidateQueries({ queryKey: memoryQueryKey }),
  });
  const status = useQuery({ ...memoryStatusQuery(), enabled: active && !lifecycle.isPending });
  const policy = useMutation({
    mutationFn: setMemoryPolicy,
    onSettled: () => client.invalidateQueries({ queryKey: memoryQueryKey }),
  });
  const mode = active ? status.data?.mode : undefined;
  const error = lifecycle.error ?? service.error ?? policy.error ?? (active ? status.error : null);
  const disabled = !active || !status.data || policy.isPending || lifecycle.isPending;
  const modeDescriptions: Record<MemoryMode, string> = {
    auto: t(
      'memory.settings.modeDescription.auto',
      'The agent can review existing memories and automatically curate long-term insights after tasks complete.'
    ),
    manual: t(
      'memory.settings.modeDescription.manual',
      'The agent can review existing memories, and only curates new ones when you explicitly ask it to remember.'
    ),
    off: t(
      'memory.settings.modeDescription.off',
      'Long-term memory is no longer provided to the agent, and no new memories are curated from conversations.'
    ),
  };

  return (
    <SettingContainer>
      <MemoryServiceCard
        status={service.data}
        loading={service.isPending}
        failed={service.isError}
        pending={lifecycle.isPending ? lifecycle.variables : undefined}
        onAction={(action) => lifecycle.mutate(action)}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('memory.settings.title', 'Memory')}</CardTitle>
          <CardDescription>
            {t(
              'memory.settings.description',
              'Sessions in every workspace share this setting; changes save automatically.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-disabled={disabled || undefined}>
              <FieldLabel id="memory-mode-label">{t('memory.settings.modeLabel', 'Memory mode')}</FieldLabel>
              <ToggleGroup
                aria-labelledby="memory-mode-label"
                aria-describedby="memory-mode-description"
                aria-busy={policy.isPending}
                value={mode ? [mode] : []}
                disabled={disabled}
                onValueChange={(values) => {
                  const next = values[0] as MemoryMode | undefined;
                  if (next && next !== mode && status.data) {
                    policy.mutate({
                      mode: next,
                      expectedRevision: status.data.revision,
                      requestId: crypto.randomUUID(),
                    });
                  }
                }}
                variant="outline"
              >
                <ToggleGroupItem value="off">
                  <CircleXIcon className="group-aria-pressed/toggle:text-primary" />
                  {t('memory.settings.mode.off', 'Off')}
                </ToggleGroupItem>
                <ToggleGroupItem value="manual">
                  <HandIcon className="group-aria-pressed/toggle:text-primary" />
                  {t('memory.settings.mode.manual', 'Manual')}
                </ToggleGroupItem>
                <ToggleGroupItem value="auto">
                  <LoaderPinwheelIcon className="group-aria-pressed/toggle:text-primary" />
                  {t('memory.settings.mode.auto', 'Auto')}
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription id="memory-mode-description" aria-live="polite">
                {!active
                  ? t('memory.settings.startHint', 'Start the memory service to view and configure the memory mode.')
                  : policy.isPending
                    ? t('memory.settings.saving', 'Saving memory mode…')
                    : mode
                      ? modeDescriptions[mode]
                      : status.isError
                        ? t('memory.settings.readError', 'The memory mode could not be read. Please try again.')
                        : t('memory.settings.reading', 'Reading memory mode…')}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error.message}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void client.invalidateQueries({ queryKey: memoryQueryKey })}
            >
              {t('memory.settings.refresh', 'Refresh settings')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </SettingContainer>
  );
}
