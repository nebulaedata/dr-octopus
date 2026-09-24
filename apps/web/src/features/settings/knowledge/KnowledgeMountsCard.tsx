/**
 * @author Codex
 * @description Verify and manage Dr.Octopus remote mounts from saved global MCP connection names.
 */
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GlobeIcon, RefreshCwIcon, UnplugIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Button } from '@octopus/ui/components/button';
import { Badge } from '@octopus/ui/components/badge';
import { Field, FieldLabel } from '@octopus/ui/components/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@octopus/ui/components/select';
import {
  changeKnowledgeMount,
  createKnowledgeMount,
  listKnowledgeConnections,
  listKnowledgeMounts,
} from '@/api/knowledge-connections';
import { useI18n } from '@/i18n/use-i18n';
import { SettingsSectionLink } from '../Layout/SettingsSectionLink';

/**
 * Store only mount identity here; edits to URL and bearer credentials stay in the existing MCP settings.
 */
export function KnowledgeMountsCard() {
  const { t } = useI18n();
  const cache = useQueryClient();
  const connections = useQuery({
    queryKey: ['knowledge', 'connections'],
    queryFn: ({ signal }) => listKnowledgeConnections(signal),
  });
  const mounts = useQuery({
    queryKey: ['knowledge', 'mounts'],
    queryFn: ({ signal }) => listKnowledgeMounts(signal),
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['knowledge', 'mounts'] });
    void cache.invalidateQueries({ queryKey: ['knowledge', 'global', 'collections'] });
  };
  const add = useMutation({ mutationFn: createKnowledgeMount, onSuccess: refresh });
  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'refresh' | 'delete' }) =>
      changeKnowledgeMount(id, action),
    onSettled: refresh,
  });
  const form = useForm({
    defaultValues: { connection: '' },
    onSubmit: ({ value }) => add.mutateAsync(value.connection).then(() => form.reset()),
  });
  const error = add.error ?? change.error ?? connections.error ?? mounts.error;
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">
          {t('settings.knowledge.mounts.title', 'Mount remote knowledge bases')}
        </CardTitle>
        <CardDescription>
          {t(
            'settings.knowledge.mounts.description',
            'Connect other Dr.Octopus instances; shared collections appear in the global list.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {t('settings.knowledge.mounts.introPrefix', 'Save the HTTP connection and Bearer credentials in')}{' '}
          <SettingsSectionLink path="/settings/mcp" className="text-primary underline underline-offset-4">
            {t('settings.knowledge.mounts.introLink', 'MCP Servers')}
          </SettingsSectionLink>{' '}
          {t('settings.knowledge.mounts.introSuffix', 'first, then select a connection to verify and mount.')}
        </p>
        <form
          className="flex items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit().catch(() => undefined);
          }}
        >
          <form.Field name="connection">
            {(field) => (
              <Field className="flex-1">
                <FieldLabel htmlFor="knowledge-mount-connection">
                  {t('settings.knowledge.mounts.connectionLabel', 'Global MCP connection')}
                </FieldLabel>
                <Select value={field.state.value} onValueChange={(value) => field.handleChange(value ?? '')}>
                  <SelectTrigger id="knowledge-mount-connection" className="w-full">
                    <SelectValue
                      placeholder={t(
                        'settings.knowledge.mounts.connectionPlaceholder',
                        'Select a configured connection'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.data?.map((item) => (
                      <SelectItem key={item.name} value={item.name} disabled={!item.available}>
                        {item.name}
                        {item.available
                          ? ''
                          : t('settings.knowledge.mounts.bearerSuffix', ' · HTTP Bearer required')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
          <Button type="submit" disabled={add.isPending}>
            {add.isPending
              ? t('settings.knowledge.mounts.verifying', 'Verifying…')
              : t('settings.knowledge.mounts.verify', 'Verify and mount')}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
        {mounts.data?.map((mount) => (
          <div key={mount.id} className="flex items-center gap-3 rounded-lg border p-3">
            <GlobeIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{mount.connectionRef}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('settings.knowledge.mounts.sharedCollections', '{{count}} shared collection', {
                  count: mount.catalog.length,
                  defaultValue_other: '{{count}} shared collections',
                })}{' '}
                ·{' '}
                {mount.error
                  ? t(
                      'settings.knowledge.mounts.unavailable',
                      'Connection unavailable; check the remote service or token'
                    )
                  : t('settings.knowledge.mounts.synced', 'Catalog synced')}
              </p>
            </div>
            <Badge variant={mount.error ? 'outline' : 'secondary'}>
              {mount.error
                ? t('settings.knowledge.mounts.pending', 'Pending recovery')
                : t('settings.knowledge.mounts.mounted', 'Mounted')}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Refresh ${mount.connectionRef}`}
              disabled={change.isPending}
              onClick={() => change.mutate({ id: mount.id, action: 'refresh' })}
            >
              <RefreshCwIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove mount ${mount.connectionRef}`}
              disabled={change.isPending}
              onClick={() => change.mutate({ id: mount.id, action: 'delete' })}
            >
              <UnplugIcon />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
