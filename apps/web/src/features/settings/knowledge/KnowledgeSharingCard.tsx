/**
 * @author Codex
 * @description Explicit read-only MCP publication with scoped collection selection and one-time token display.
 */
import { copyTextWithFeedback } from '@/lib/copy-text-with-feedback';
import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Button } from '@octopus/ui/components/button';
import { ListPagination } from '@/components/ListPagination';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { Switch } from '@octopus/ui/components/switch';
import { Input } from '@octopus/ui/components/input';
import { Field, FieldLabel } from '@octopus/ui/components/field';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import { listKnowledgeCollections } from '@/api/knowledge';
import { getKnowledgeSharing, saveKnowledgeSharing } from '@/api/knowledge-connections';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeSharing } from '@octopus/shared/protocol/knowledge';

/**
 * Keep the one-time credential outside query caches and clear it when leaving this Settings surface.
 */
export function KnowledgeSharingCard() {
  const { t } = useI18n();
  const [token, setToken] = useState<string>();
  const policy = useQuery({
    queryKey: ['knowledge', 'sharing'],
    queryFn: ({ signal }) => getKnowledgeSharing(signal),
  });
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">{t('settings.knowledge.sharing.title', 'External knowledge MCP')}</CardTitle>
        <CardDescription>
          {t(
            'settings.knowledge.sharing.description',
            'Share selected global collections read-only with other agents. The service must stay running.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">
          {`${location.origin}/mcp/knowledge`}
        </p>
        {policy.data ? (
          <SharingForm key={policy.data.revision} policy={policy.data} onToken={setToken} />
        ) : null}
        {policy.error ? (
          <p role="alert" className="text-sm text-destructive">
            {policy.error.message}
          </p>
        ) : null}
        {token ? (
          <Alert>
            <AlertDescription>
              <p>
                {t(
                  'settings.knowledge.sharing.tokenNotice',
                  'The new token is shown only once; save it to the connecting party\'s MCP configuration. The old token is revoked.'
                )}
              </p>
              <Input
                className="mt-3 font-mono text-xs"
                aria-label="Newly generated knowledge access token"
                readOnly
                value={token}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  void copyTextWithFeedback(token);
                }}
              >
                {t('settings.knowledge.sharing.copyToken', 'Copy token')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Publish only local global rows, retaining selections across ordinary collection pages.
 */
function SharingForm({
  policy,
  onToken,
}: {
  policy: KnowledgeSharing;
  onToken(token: string | undefined): void;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const cache = useQueryClient();
  const collections = useQuery({
    queryKey: ['knowledge', 'global', 'collections', page],
    queryFn: ({ signal }) => listKnowledgeCollections(undefined, page, signal),
  });
  const save = useMutation({
    mutationFn: saveKnowledgeSharing,
    onSuccess: (value) => {
      cache.setQueryData(['knowledge', 'sharing'], value.settings);
      onToken(value.token);
      void cache.invalidateQueries({ queryKey: ['knowledge', 'global', 'collections'] });
    },
  });
  const form = useForm({
    defaultValues: {
      enabled: policy.enabled,
      tls: policy.network === 'tls',
      hosts: policy.allowedHosts.join(', '),
      origins: policy.allowedOrigins.join(', '),
      collectionIds: policy.collectionIds,
      rotateToken: false,
    },
    onSubmit: ({ value }) =>
      save
        .mutateAsync({
          revision: policy.revision,
          enabled: value.enabled,
          network: value.tls ? 'tls' : 'loopback',
          allowedHosts: value.hosts
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          allowedOrigins: value.origins
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          collectionIds: value.collectionIds,
          rotateToken: value.rotateToken,
        })
        .then(() => undefined),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <form.Field name="enabled">
        {(field) => (
          <Field className="flex-row items-center">
            <Switch
              id="knowledge-sharing-enabled"
              checked={field.state.value}
              onCheckedChange={field.handleChange}
            />
            <FieldLabel htmlFor="knowledge-sharing-enabled">
              {t('settings.knowledge.sharing.enableLabel', 'Enable knowledge MCP')}
            </FieldLabel>
          </Field>
        )}
      </form.Field>
      <form.Field name="collectionIds">
        {(field) => (
          <Field>
            <FieldLabel>{t('settings.knowledge.sharing.collectionsLabel', 'Shared collections')}</FieldLabel>
            <div className="space-y-2 rounded-lg border p-3">
              {collections.data?.items
                .filter((item) => item.source !== 'remote')
                .map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.state.value.includes(item.id)}
                      onCheckedChange={(checked) =>
                        field.handleChange(
                          checked
                            ? [...field.state.value, item.id]
                            : field.state.value.filter((id) => id !== item.id)
                        )
                      }
                    />
                    {item.name}
                  </label>
                ))}
              {!collections.data?.items.length ? (
                <p className="text-sm text-muted-foreground">
                  {t('settings.knowledge.sharing.noCollections', 'Create a local global collection first.')}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <span className="text-xs text-muted-foreground">
                  {t('settings.knowledge.sharing.selectedCount', '{{count}} collection selected', {
                    count: field.state.value.length,
                    defaultValue_other: '{{count}} collections selected',
                  })}
                </span>
                <ListPagination
                  aria-label="Shared collections pagination"
                  className="w-auto"
                  page={page}
                  pageCount={Math.max(1, Math.ceil((collections.data?.total ?? 0) / 20))}
                  disabled={collections.isFetching}
                  onPageChange={setPage}
                />
              </div>
            </div>
          </Field>
        )}
      </form.Field>
      <form.Field name="tls">
        {(field) => (
          <Field className="flex-row items-center">
            <Switch
              id="knowledge-sharing-tls"
              checked={field.state.value}
              onCheckedChange={field.handleChange}
            />
            <FieldLabel htmlFor="knowledge-sharing-tls">
              {t('settings.knowledge.sharing.tlsLabel', 'Allow other devices to access via HTTPS')}
            </FieldLabel>
          </Field>
        )}
      </form.Field>
      <p className="text-xs text-muted-foreground">
        {t(
          'settings.knowledge.sharing.networkHint',
          'Loopback-only by default. Other devices must connect through the HTTPS entry; the proxy trust scope follows the server configuration.'
        )}
      </p>
      <form.Field name="hosts">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="knowledge-sharing-hosts">
              {t('settings.knowledge.sharing.hostsLabel', 'Allowed hostnames')}
            </FieldLabel>
            <Input
              id="knowledge-sharing-hosts"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="localhost, kb.example.com"
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="origins">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="knowledge-sharing-origins">
              {t('settings.knowledge.sharing.originsLabel', 'Allowed browser origins (optional)')}
            </FieldLabel>
            <Input
              id="knowledge-sharing-origins"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="https://example.com"
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="rotateToken">
        {(field) => (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={field.state.value} onCheckedChange={(value) => field.handleChange(!!value)} />
            {t('settings.knowledge.sharing.rotateLabel', 'Generate a new token and revoke the old one')}
          </label>
        )}
      </form.Field>
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={save.isPending} type="submit">
          {t('settings.knowledge.sharing.save', 'Save sharing settings')}
        </Button>
      </div>
    </form>
  );
}
