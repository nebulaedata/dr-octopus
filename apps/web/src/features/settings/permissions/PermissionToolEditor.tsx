/**
 * @author Codex
 * @description Edits exact-tool actions and declarative classification rules while preserving inheritance and other tools.
 */
import { ChevronRightIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PermissionConfigSchema, PermissionToolRuleSchema } from '@octopus/shared/protocol';
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import { Textarea } from '@octopus/ui/components/textarea';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { Spinner } from '@octopus/ui/components/spinner';
import { updatePermissionSettings } from '@/api/permissions';
import { PermissionActionBadge } from './PermissionActionBadge';
import { PermissionSelect } from './PermissionSelect';
import { PermissionToolJsonHelp } from './PermissionJsonHelp';
import { getModeLabels } from '@/features/settings/utils/permission-labels';
import { useI18n } from '@/i18n/use-i18n';
import type { PermissionConfig, PermissionSettingsSnapshot } from '@octopus/shared/protocol';

/**
 * Edit one rule against its captured revision; blank fields restore inheritance rather than freezing defaults.
 */
export function PermissionToolEditor({
  snapshot,
  workspaceId,
  tool,
  onClose,
}: {
  snapshot: PermissionSettingsSnapshot;
  workspaceId?: string;
  tool?: string;
  /**
   * Close only after success or explicit draft dismissal.
   */
  onClose(): void;
}) {
  const { t } = useI18n();
  const modeLabels = getModeLabels(t);
  const client = useQueryClient();
  const overlay = snapshot.overrides ?? {};
  const descriptor = tool ? overlay.toolRules?.[tool] : undefined;
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
      name: tool ?? '',
      descriptor: descriptor === undefined ? '' : JSON.stringify(descriptor, null, 2),
      policy: tool ? (overlay.policy?.tools?.[tool] ?? 'inherit') : 'inherit',
      ask: tool ? (overlay.modes?.ask?.tools?.[tool] ?? 'inherit') : 'inherit',
      auto: tool ? (overlay.modes?.auto?.tools?.[tool] ?? 'inherit') : 'inherit',
      full: tool ? (overlay.modes?.full?.tools?.[tool] ?? 'inherit') : 'inherit',
    },
    onSubmit: async ({ value }) => {
      const config = structuredClone(overlay);
      config.toolRules ??= {};
      if (value.descriptor.trim() === '') {
        delete config.toolRules[value.name];
      } else {
        config.toolRules[value.name] = PermissionToolRuleSchema.nullable().parse(
          JSON.parse(value.descriptor)
        );
      }
      config.policy ??= {};
      config.policy.tools ??= {};
      config.modes ??= {};
      for (const name of ['policy', 'ask', 'auto', 'full'] as const) {
        const section = name === 'policy' ? config.policy : (config.modes[name] ??= {});
        section.tools ??= {};
        const action = value[name];
        if (action === 'inherit') {
          delete section.tools[value.name];
        } else {
          section.tools[value.name] = action as 'allow' | 'ask' | 'deny';
        }
      }
      save.mutate(PermissionConfigSchema.parse(config));
    },
  });
  /**
   * Remove only this tool's local overrides, allowing inherited rules to become effective again.
   */
  function resetTool() {
    if (!tool) {
      return;
    }
    const config = structuredClone(overlay);
    delete config.toolRules?.[tool];
    delete config.policy?.tools?.[tool];
    for (const name of ['ask', 'auto', 'full'] as const) {
      delete config.modes?.[name]?.tools?.[tool];
    }
    save.mutate(config);
  }
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
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={!save.isPending}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6 sm:pr-12">
          <DialogTitle>
            {tool
              ? t('settings.permissions.toolEditor.editTitle', 'Edit tool rule')
              : t('settings.permissions.toolEditor.addTitle', 'Add tool rule')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'settings.permissions.toolEditor.description',
              'Exact tool-name match. Fixed policy takes precedence over mode configuration, and any deny rule over approvals.'
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
          <ScrollArea className="flex min-h-0 flex-1 flex-col overflow-hidden *:data-[slot=scroll-area-viewport]:min-h-0 [&>[data-slot=scroll-area-viewport]]:h-auto [&>[data-slot=scroll-area-viewport]]:flex-1 [&>[data-slot=scroll-area-viewport]]:overscroll-contain">
            <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
              <form.Field
                name="name"
                validators={{
                  onChange: ({ value }) => {
                    if (
                      !PermissionConfigSchema.safeParse({ policy: { tools: { [value]: 'ask' } } }).success
                    ) {
                      return t(
                        'settings.permissions.toolEditor.nameInvalid',
                        'Enter a valid tool name; whitespace and reserved field names are not supported'
                      );
                    } else if (
                      !tool &&
                      (snapshot.effective?.toolRules[value] ||
                        snapshot.effective?.policy.tools[value] ||
                        Object.values(snapshot.effective?.modes ?? {}).some((mode) => mode.tools[value]))
                    ) {
                      return t(
                        'settings.permissions.toolEditor.nameExists',
                        'This tool already exists; edit the existing rule'
                      );
                    } else {
                      return undefined;
                    }
                  },
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor="permission-tool-name">
                      {t('settings.permissions.toolEditor.nameLabel', 'Tool name')}
                    </FieldLabel>
                    <Input
                      id="permission-tool-name"
                      placeholder={t(
                        'settings.permissions.toolEditor.namePlaceholder',
                        'e.g. knowledge_search'
                      )}
                      value={field.state.value}
                      disabled={Boolean(tool) || save.isPending}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  </Field>
                )}
              </form.Field>
              <div className="grid grid-cols-2 gap-3">
                {(['policy', 'ask', 'auto', 'full'] as const).map((name) => (
                  <form.Field name={name} key={name}>
                    {(field) => {
                      /**
                       * Selects action in the existing condition order.
                       */
                      function selectAction() {
                        if (tool) {
                          if (name === 'policy') {
                            return snapshot.inherited?.policy.tools[tool];
                          } else {
                            return snapshot.inherited?.modes[name].tools[tool];
                          }
                        } else {
                          return undefined;
                        }
                      }
                      return (
                        <Field>
                          <FieldLabel>
                            {name === 'policy'
                              ? t('settings.permissions.toolEditor.policyLabel', 'Fixed policy')
                              : modeLabels[name]}
                          </FieldLabel>
                          <PermissionSelect
                            label={
                              name === 'policy'
                                ? t('settings.permissions.toolEditor.policyLabel', 'Fixed policy')
                                : modeLabels[name]
                            }
                            value={field.state.value}
                            onChange={field.handleChange}
                            disabled={save.isPending}
                          />
                          <FieldDescription>
                            {t('settings.permissions.toolEditor.defaultPrefix', 'Default: ')}
                            <PermissionActionBadge action={selectAction()} />
                          </FieldDescription>
                        </Field>
                      );
                    }}
                  </form.Field>
                ))}
              </div>
              <form.Field
                name="descriptor"
                validators={{
                  onChange: ({ value }) => {
                    if (!value.trim()) {
                      return undefined;
                    }
                    try {
                      PermissionToolRuleSchema.nullable().parse(JSON.parse(value));
                      return undefined;
                    } catch {
                      return t(
                        'settings.permissions.toolEditor.descriptorInvalid',
                        'Enter a valid tool descriptor JSON, or leave empty to use the default configuration'
                      );
                    }
                  },
                }}
              >
                {(field) => (
                  <Collapsible defaultOpen={false} className="flex flex-col gap-2 mt-2">
                    <CollapsibleTrigger
                      render={<Button type="button" variant="ghost" />}
                      className="w-full flex items-center justify-start data-panel-open:[&>svg]:rotate-90 px-0"
                    >
                      <ChevronRightIcon className="text-muted-foreground" />
                      {t('settings.permissions.toolEditor.advanced', 'Advanced configuration')}
                    </CollapsibleTrigger>
                    <CollapsibleContent keepMounted>
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor="permission-tool-descriptor">
                          {t(
                            'settings.permissions.toolEditor.descriptorLabel',
                            'Tool kind and approval scope (JSON)'
                          )}
                        </FieldLabel>
                        <Textarea
                          id="permission-tool-descriptor"
                          className="min-h-40 font-mono text-xs"
                          placeholder={JSON.stringify(
                            tool
                              ? (snapshot.inherited?.toolRules[tool] ?? { kind: 'custom' })
                              : { kind: 'custom' },
                            null,
                            2
                          )}
                          value={field.state.value}
                          disabled={save.isPending}
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                          aria-invalid={field.state.meta.errors.length > 0}
                          spellCheck={false}
                        />
                        <FieldDescription>
                          {t(
                            'settings.permissions.toolEditor.descriptorDescription',
                            'If you are unsure, leave empty to use the default configuration; field reference and examples below:'
                          )}
                        </FieldDescription>
                        <PermissionToolJsonHelp />
                      </Field>
                    </CollapsibleContent>
                    <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
                  </Collapsible>
                )}
              </form.Field>
              {save.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{save.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </ScrollArea>
          <DialogFooter className="m-0 shrink-0 flex-row flex-wrap justify-end px-5 py-4 sm:px-6">
            {tool ? (
              <Button type="button" variant="outline" disabled={save.isPending} onClick={resetTool}>
                {t('settings.permissions.restoreDefaults', 'Restore defaults')}
              </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.values.name] as const}>
              {([canSubmit, name]) => (
                <Button type="submit" disabled={!canSubmit || !name || save.isPending}>
                  {save.isPending ? <Spinner /> : null}
                  {t('settings.permissions.toolEditor.save', 'Save rule')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
