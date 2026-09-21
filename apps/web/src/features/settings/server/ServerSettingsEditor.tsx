/**
 * @author Codex
 * @description Presents Server configuration, storage intent and explicit restart within both Settings surfaces.
 */
import { useRef } from 'react';
import { useSafeState } from 'ahooks';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { serverSettingKeys } from '@octopus/shared/protocol';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { FieldGroup } from '@octopus/ui/components/field';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@octopus/ui/components/card';
import { Spinner } from '@octopus/ui/components/spinner';
import { getServerSettings, saveServerSettings } from '@/api/server-settings';
import { useI18n } from '@/i18n/use-i18n';
import { ApiRequestError } from '@/utils/request';
import { SettingContainer } from '../layout/SettingContainer';
import { ServerField } from './ServerField';
import { ServerRestart } from './ServerRestart';
import { ServerAccessNotice } from './ServerAccessNotice';
import { ServerExposureDialog, UnsavedGuard } from './ServerConfirmations';
import { normalizeOrigins, serverChanges, serverDraft, validateServerField } from './server-fields';
import type { ServerSettingsDto, UpdateEnvironmentBody } from '@octopus/shared/protocol';
import type { ServerDraft } from './server-fields';

/**
 * Captures the editing revision so background reads cannot silently authorize stale drafts.
 */
export function ServerSettingsEditor({
  initial,
  latest,
}: {
  initial: ServerSettingsDto;
  latest: ServerSettingsDto;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [snapshot, setSnapshot] = useSafeState(initial);
  const [pending, setPending] = useSafeState(false);
  const [restarting, setRestarting] = useSafeState(false);
  const [message, setMessage] = useSafeState('');
  const [confirmation, setConfirmation] = useSafeState<UpdateEnvironmentBody>();
  const lock = useRef(false);
  const base = serverDraft(snapshot);
  /**
   * Retains drafts on failure and checks stored intent if the save response is lost.
   */
  async function save(input: UpdateEnvironmentBody, confirmed = false): Promise<void> {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setPending(true);
    setMessage('');
    try {
      const response = await saveServerSettings(input, confirmed);
      setSnapshot(response.settings);
      form.reset(serverDraft(response.settings));
      client.setQueryData(['server-settings'], response.settings);
      await client.invalidateQueries({ queryKey: ['environment-settings'] });
      setConfirmation(undefined);
      setMessage(
        response.warnings.length
          ? t(
              'settings.server.savedWithOverrideWarning',
              'Settings saved, but some values are still overridden by the launch configuration.'
            )
          : t('settings.server.savedNoRestart', 'Settings saved. Saving does not restart the service.')
      );
    } catch (cause) {
      setConfirmation(undefined);
      if (cause instanceof ApiRequestError && cause.code === 'SERVER_EXPOSURE_CONFIRMATION_REQUIRED') {
        setConfirmation(input);
      } else if (cause instanceof ApiRequestError && cause.statusCode) {
        setMessage(
          cause.code === 'ENV_CONFLICT'
            ? t(
                'settings.server.conflictMessage',
                'The configuration was modified in another window. Your draft is preserved; review the latest configuration before deciding whether to discard and edit again.'
              )
            : cause.message
        );
      } else {
        try {
          const current = await getServerSettings();
          const matches = Object.entries(input.changes).every(([key, value]) => {
            const stored = current.fields[key as keyof ServerDraft].stored;
            return value === null ? !stored.configured : stored.configured && stored.value === value;
          });
          setMessage(
            matches
              ? t(
                  'settings.server.responseLostMatched',
                  'The stored values already match the submission; the response was lost, so nothing was resubmitted.'
                )
              : t(
                  'settings.server.responseLostUnknown',
                  'Submission result unknown; your draft is preserved. Refresh to verify.'
                )
          );
        } catch {
          setMessage(
            t(
              'settings.server.responseLostConnection',
              'Submission result unknown; your draft is preserved. Check the service connection.'
            )
          );
        }
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  const form = useForm({
    defaultValues: base,
    onSubmit: async ({ value }) => {
      const changes = serverChanges(base, value);
      if (typeof changes.SERVER_CORS_ORIGIN === 'string') {
        changes.SERVER_CORS_ORIGIN = normalizeOrigins(changes.SERVER_CORS_ORIGIN.split(','));
      }
      if (Object.keys(changes).length) {
        await save({ revision: snapshot.revision, changes });
      }
    },
  });
  const runtime = latest.runtime;
  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <SettingContainer>
          <div className="flex flex-col gap-3">
            <form.Subscribe selector={(state) => state.isDirty}>
              {(dirty) => (
                <>
                  <UnsavedGuard dirty={dirty} />
                  <ServerRestart
                    snapshot={latest}
                    disabled={dirty || pending || restarting}
                    onBusy={setRestarting}
                  />
                  {dirty ? (
                    <p className="text-xs text-muted-foreground">
                      {t('settings.server.saveBeforeRestart', 'Save or discard changes before restarting.')}
                    </p>
                  ) : null}
                </>
              )}
            </form.Subscribe>
          </div>
          <form.Subscribe
            selector={(state) => [state.values.SERVER_HOST, state.values.SERVER_CORS_ORIGIN] as const}
          >
            {([host, cors]) => <ServerAccessNotice snapshot={snapshot} host={host} cors={cors} />}
          </form.Subscribe>
          {snapshot.prediction === 'host_managed' ? (
            <Alert>
              <AlertDescription>
                {t(
                  'settings.server.hostManagedAlert',
                  'This service is managed by an embedding host and the next load values cannot be predicted. Contact the host application configuration after saving.'
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          {latest.diagnostics.map((text) => (
            <Alert key={text} variant="destructive">
              <AlertDescription>{text}</AlertDescription>
            </Alert>
          ))}
          {[
            {
              title: t('settings.server.sectionNetwork', 'Network access'),
              description: t(
                'settings.server.sectionNetworkDescription',
                'Save the listen scope and port; takes effect after a restart.'
              ),
              keys: serverSettingKeys.slice(0, 3),
            },
            {
              title: t('settings.server.sectionSessions', 'Session instances'),
              description: t(
                'settings.server.sectionSessionsDescription',
                'Limit resident session processes, including idle instances. The workspace cap is still bounded by the global cap.'
              ),
              keys: serverSettingKeys.slice(3, 5),
            },
            {
              title: t('settings.server.sectionFileLog', 'File logging'),
              description: t(
                'settings.server.sectionFileLogDescription',
                'Actual state: {{state}} · Log directory: {{directory}}',
                { state: runtime.fileLogging.state, directory: runtime.fileLogging.directory }
              ),
              keys: serverSettingKeys.slice(5),
            },
          ].map((section) => (
            <Card key={section.title}>
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription className="break-all">{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <form.Subscribe selector={(state) => state.values.SERVER_FILE_LOG_ENABLED}>
                    {(enabled) =>
                      section.keys
                        .filter(
                          (name) =>
                            !name.startsWith('SERVER_FILE_LOG_') ||
                            name === 'SERVER_FILE_LOG_ENABLED' ||
                            ['true', '1'].includes(
                              enabled ??
                                String(
                                  snapshot.fields.SERVER_FILE_LOG_ENABLED.next.value ??
                                    snapshot.fields.SERVER_FILE_LOG_ENABLED.current.value
                                )
                            )
                        )
                        .map((name) => (
                          <form.Field
                            key={name}
                            name={name}
                            validators={{ onChange: ({ value }) => validateServerField(t, name, value) }}
                          >
                            {(field) =>
                              name === 'SERVER_CORS_ORIGIN' ? (
                                <details>
                                  <summary className="cursor-pointer text-sm">
                                    {t('settings.server.advancedSettings', 'Advanced settings')}
                                  </summary>
                                  <div className="mt-4">
                                    <ServerField
                                      name={name}
                                      value={field.state.value}
                                      snapshot={snapshot}
                                      disabled={pending || restarting}
                                      error={field.state.meta.errors[0]}
                                      onChange={field.handleChange}
                                    />
                                  </div>
                                </details>
                              ) : (
                                <ServerField
                                  name={name}
                                  value={field.state.value}
                                  snapshot={snapshot}
                                  disabled={pending || restarting}
                                  error={field.state.meta.errors[0]}
                                  onChange={(value) => {
                                    field.handleChange(value);
                                    if (name === 'SERVER_FILE_LOG_ENABLED' && value === 'false') {
                                      form.setFieldValue('SERVER_FILE_LOG_REQUIRED', 'false');
                                    }
                                  }}
                                />
                              )
                            }
                          </form.Field>
                        ))
                    }
                  </form.Subscribe>
                </FieldGroup>
              </CardContent>
            </Card>
          ))}
          {message ? (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
        </SettingContainer>
      </div>
      <footer className="shrink-0 border-t bg-background px-4 py-4 md:px-8">
        <form.Subscribe selector={(state) => [state.isDirty, state.canSubmit] as const}>
          {([dirty, canSubmit]) => (
            <div className="mx-auto flex w-full max-w-3xl flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending || restarting}
                onClick={async () => {
                  try {
                    const current = await client.fetchQuery({
                      queryKey: ['server-settings'],
                      queryFn: () => getServerSettings(),
                      staleTime: 0,
                    });
                    setSnapshot(current);
                    form.reset(serverDraft(current));
                    setMessage(t('settings.server.reloaded', 'Latest configuration loaded.'));
                  } catch {
                    setMessage(
                      t('settings.server.refreshFailed', 'Unable to refresh the configuration; your draft is preserved.')
                    );
                  }
                }}
              >
                {t('settings.server.discardRefresh', 'Discard changes / Refresh')}
              </Button>
              <Button
                type="submit"
                disabled={!dirty || !canSubmit || pending || restarting || !latest.capabilities.edit}
              >
                {pending ? <Spinner /> : null}
                {t('settings.server.saveSettings', 'Save settings')}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </footer>
      <ServerExposureDialog
        open={!!confirmation}
        pending={pending}
        onCancel={() => setConfirmation(undefined)}
        onConfirm={() => {
          if (confirmation) {
            void save(confirmation, true);
          }
        }}
      />
    </form>
  );
}
