/**
 * @author Codex
 * @description Edits mode defaults or raw permission overlays with shared validation and stale-write protection.
 */
import { HandIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PermissionActionSchema, PermissionConfigSchema } from '@octopus/shared/protocol';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Textarea } from '@octopus/ui/components/textarea';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { Spinner } from '@octopus/ui/components/spinner';
import { updatePermissionSettings } from '@/api/permissions';
import { PermissionActionBadge } from './PermissionActionBadge';
import { PermissionSelect } from './PermissionSelect';
import { PermissionConfigJsonHelp } from './PermissionJsonHelp';
import { getKindLabels, getModeLabels } from './permission-labels';
import { useI18n } from '@/i18n/use-i18n';
import type { PermissionConfig, PermissionSettingsSnapshot } from '@octopus/shared/protocol';

const modeIcons = { ask: HandIcon, auto: ShieldCheckIcon, full: ShieldAlertIcon };

/**
 * Translate an omitted mode default into an explicit inheritance choice for editing.
 */
function modeDraft(snapshot: PermissionSettingsSnapshot, mode: 'ask' | 'auto' | 'full') {
  const value = snapshot.overrides?.modes?.[mode];
  return {
    read: value?.kinds?.read ?? 'inherit',
    write: value?.kinds?.write ?? 'inherit',
    shell: value?.kinds?.shell ?? 'inherit',
    custom: value?.kinds?.custom ?? 'inherit',
    external: value?.external ?? 'inherit',
  };
}

/**
 * Share one save path between guided configuration and complete JSON editing or repair.
 */
export function PermissionConfigEditor({
  snapshot,
  workspaceId,
  mode,
  onClose,
}: {
  snapshot: PermissionSettingsSnapshot;
  workspaceId?: string;
  mode: 'general' | 'json';
  /**
   * Dismiss the captured draft after a save or explicit cancellation.
   */
  onClose(): void;
}) {
  const { t } = useI18n();
  const kindLabels = getKindLabels(t);
  const modeLabels = getModeLabels(t);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (config: PermissionConfig) =>
      updatePermissionSettings({ revision: snapshot.revision, config }, workspaceId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['permission-settings'] });
      onClose();
    },
  });
  const form = useForm({
    defaultValues: {
      raw: snapshot.overrides ? JSON.stringify(snapshot.overrides, null, 2) : snapshot.raw,
      modes: {
        ask: modeDraft(snapshot, 'ask'),
        auto: modeDraft(snapshot, 'auto'),
        full: modeDraft(snapshot, 'full'),
      },
    },
    onSubmit: async ({ value }) => {
      if (mode === 'json') {
        save.mutate(PermissionConfigSchema.parse(JSON.parse(value.raw)));
        return;
      }
      const config = structuredClone(snapshot.overrides ?? {});
      config.modes ??= {};
      for (const name of ['ask', 'auto', 'full'] as const) {
        const section = (config.modes[name] ??= {});
        section.kinds ??= {};
        for (const kind of ['read', 'write', 'shell', 'custom'] as const) {
          const action = value.modes[name][kind];
          if (action === 'inherit') {
            delete section.kinds[kind];
          } else {
            section.kinds[kind] = PermissionActionSchema.parse(action);
          }
        }
        const external = value.modes[name].external;
        if (external === 'inherit') {
          delete section.external;
        } else {
          section.external = PermissionActionSchema.parse(external);
        }
      }
      save.mutate(PermissionConfigSchema.parse(config));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={!save.isPending}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6 sm:pr-12">
          <DialogTitle>
            {mode === 'json'
              ? t('settings.permissions.configEditor.jsonTitle', 'JSON permission configuration')
              : t('settings.permissions.configEditor.generalTitle', 'Run modes')}
          </DialogTitle>
          <DialogDescription>
            {workspaceId
              ? t(
                  'settings.permissions.configEditor.workspaceDescription',
                  'Configure permissions for the current workspace; choose "Default" to use global configuration.'
                )
              : t(
                  'settings.permissions.configEditor.globalDescription',
                  'Configure default permissions for all workspaces; choose "Default" to use system presets.'
                )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <ScrollArea className="flex min-h-0 flex-1 flex-col overflow-hidden [&>[data-slot=scroll-area-viewport]]:min-h-0 [&>[data-slot=scroll-area-viewport]]:h-auto [&>[data-slot=scroll-area-viewport]]:flex-1 [&>[data-slot=scroll-area-viewport]]:overscroll-contain">
            <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
              {mode === 'json' ? (
                <form.Field
                  name="raw"
                  validators={{
                    onChange: ({ value }) => {
                      try {
                        PermissionConfigSchema.parse(JSON.parse(value));
                        return undefined;
                      } catch (error) {
                        return error instanceof SyntaxError
                          ? t('settings.permissions.configEditor.jsonSyntaxError', 'JSON syntax error')
                          : t(
                              'settings.permissions.configEditor.jsonInvalid',
                              'Configuration fields or values are invalid; check tool rules, modes and audit options.'
                            );
                      }
                    },
                  }}
                >
                  {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor="permission-json">
                        {t('settings.permissions.configEditor.rawLabel', 'Scope-level configuration')}
                      </FieldLabel>
                      <Textarea
                        id="permission-json"
                        className="min-h-80 font-mono text-xs"
                        value={field.state.value}
                        disabled={save.isPending}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={field.state.meta.errors.length > 0}
                        spellCheck={false}
                      />
                      <FieldDescription>
                        {t(
                          'settings.permissions.configEditor.rawDescriptionPrefix',
                          'Supports toolRules, requestDefaults, policy, modes and audit fields. Saving an empty object '
                        )}
                        {'{}'}
                        {t(
                          'settings.permissions.configEditor.rawDescriptionSuffix',
                          ' restores all defaults for this scope; setting null in toolRules removes the default kind.'
                        )}
                      </FieldDescription>
                      <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                      <PermissionConfigJsonHelp />
                    </Field>
                  )}
                </form.Field>
              ) : (
                <>
                  {(['ask', 'auto', 'full'] as const).map((name) => {
                    const ModeIcon = modeIcons[name];
                    return (
                      <section
                        className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4"
                        key={name}
                        aria-labelledby={`permission-mode-${name}`}
                      >
                        <h3
                          id={`permission-mode-${name}`}
                          className="flex items-center gap-2 text-sm font-medium"
                        >
                          <ModeIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                          {modeLabels[name]}
                        </h3>
                        <FieldGroup className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
                          {(['read', 'write', 'shell', 'custom', 'external'] as const).map((kind) => (
                            <form.Field key={kind} name={`modes.${name}.${kind}`}>
                              {(field) => (
                                <Field>
                                  <FieldLabel>{kindLabels[kind]}</FieldLabel>
                                  <PermissionSelect
                                    className="w-10!"
                                    label={t('settings.permissions.configEditor.modeKindAriaLabel', '{{mode}} {{kind}}', {
                                      mode: modeLabels[name],
                                      kind: kindLabels[kind],
                                    })}
                                    value={field.state.value}
                                    onChange={(value) =>
                                      field.handleChange(value as typeof field.state.value)
                                    }
                                    disabled={save.isPending}
                                  />
                                  <FieldDescription>
                                    <span className="text-xs">
                                      {t('settings.permissions.toolEditor.defaultPrefix', 'Default: ')}
                                    </span>
                                    <PermissionActionBadge
                                      action={
                                        kind === 'external'
                                          ? snapshot.inherited?.modes[name].external
                                          : snapshot.inherited?.modes[name].kinds[kind]
                                      }
                                    />
                                  </FieldDescription>
                                </Field>
                              )}
                            </form.Field>
                          ))}
                        </FieldGroup>
                      </section>
                    );
                  })}
                </>
              )}
              {save.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{save.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </ScrollArea>
          <DialogFooter className="m-0 shrink-0 flex-row justify-end px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <form.Subscribe selector={(state) => state.canSubmit}>
              {(canSubmit) => (
                <Button type="submit" disabled={!canSubmit || save.isPending}>
                  {save.isPending ? <Spinner /> : null}
                  {t('settings.permissions.configEditor.save', 'Save configuration')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
