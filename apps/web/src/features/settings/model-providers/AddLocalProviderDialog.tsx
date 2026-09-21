/**
 * @author Codex
 * @description Collects a provider name and onboarding runtime type before creating a persistent draft.
 */
import { useForm } from '@tanstack/react-form';
import { CreateLocalProviderBodySchema } from '@octopus/shared/protocol';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { Avatar, AvatarFallback } from '@octopus/ui/components/avatar';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@octopus/ui/components/field';
import { Input } from '@octopus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { useLocalProviderMutations, useLocalRuntimes } from '@/queries/local-provider-queries';
import { useI18n } from '@/i18n/use-i18n';
import type { LocalRuntime } from '@octopus/shared/protocol';

/**
 * Renders a compact creation dialog; the parent mounts a fresh form for each opening.
 */
export function AddLocalProviderDialog({
  onClose,
  onCreated,
}: {
  /**
   * Closes the dialog after cancellation or creation.
   */
  onClose(): void;
  /**
   * Selects the newly created provider's route.
   */
  onCreated(providerKey: string): void;
}) {
  const { t } = useI18n();
  const runtimes = useLocalRuntimes();
  const { create } = useLocalProviderMutations();
  const form = useForm({
    defaultValues: { name: '', runtime: 'ollama' as LocalRuntime },
    validators: { onChange: CreateLocalProviderBodySchema },
    onSubmit: async ({ value }) => {
      try {
        const provider = await create.mutateAsync(value);
        onCreated(provider.providerKey);
        onClose();
      } catch {
        /* Mutation state presents the server error and preserves input. */
      }
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('settings.providers.local.addTitle', 'Add provider')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t(
              'settings.providers.local.addDescription',
              'Add a local model service, then configure its endpoint and models.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Subscribe selector={(state) => state.values.name}>
            {(name) => (
              <Avatar className="mx-auto size-14">
                <AvatarFallback>{name.trim().slice(0, 1).toLocaleUpperCase() || 'P'}</AvatarFallback>
              </Avatar>
            )}
          </form.Subscribe>
          <FieldGroup>
            <form.Field name="name">
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="local-provider-name">
                    {t('settings.providers.local.nameLabel', 'Provider name')}
                  </FieldLabel>
                  <Input
                    id="local-provider-name"
                    placeholder={t('settings.providers.local.namePlaceholder', 'e.g. My Ollama')}
                    maxLength={80}
                    disabled={create.isPending}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <form.Field name="runtime">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="local-provider-runtime">
                    {t('settings.providers.local.runtimeLabel', 'Provider type')}
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    items={
                      runtimes.data?.map((runtime) => ({ value: runtime.id, label: runtime.name })) ?? []
                    }
                    onValueChange={(value) => {
                      if (value) {
                        field.handleChange(value);
                      }
                    }}
                    disabled={runtimes.isPending || create.isPending}
                  >
                    <SelectTrigger id="local-provider-runtime" className="w-full" onBlur={field.handleBlur}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {runtimes.data?.map((runtime) => (
                          <SelectItem key={runtime.id} value={runtime.id}>
                            {runtime.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
          </FieldGroup>
          {runtimes.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {t('settings.providers.local.runtimesFailed', 'Failed to load provider types.')}
                <Button type="button" variant="outline" size="sm" onClick={() => void runtimes.refetch()}>
                  {t('common.retry', 'Retry')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {create.isError && (
            <Alert variant="destructive">
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.values.name] as const}>
              {([canSubmit, name]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || !name.trim() || !runtimes.data?.length || create.isPending}
                >
                  {create.isPending
                    ? t('settings.providers.local.adding', 'Adding…')
                    : t('common.confirm', 'Confirm')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
