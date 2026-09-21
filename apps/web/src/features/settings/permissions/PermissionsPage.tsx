/**
 * @author Codex
 * @description Presents global and workspace permission overrides using the shared Settings layout and inherited previews.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CodeIcon, PencilIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { SearchInput } from '@/components/SearchInput';
import { Spinner } from '@octopus/ui/components/spinner';
import { Tabs, TabsContent } from '@octopus/ui/components/tabs';
import { PageTabList } from '@/components/PageTabList';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@octopus/ui/components/table';
import { getPermissionSettings } from '@/api/permissions';
import { useWorkspaces } from '@/queries/workbench-queries';
import { SettingContainer } from '../layout/SettingContainer';
import { PermissionActionBadge } from './PermissionActionBadge';
import { PermissionSelect } from './PermissionSelect';
import { getKindLabels, getModeLabels } from './permission-labels';
import { PermissionResetButton } from './PermissionResetButton';
import { PermissionAuditCard } from './PermissionAuditCard';
import { PermissionConfigEditor } from './PermissionConfigEditor';
import { PermissionToolEditor } from './PermissionToolEditor';
import { useI18n } from '@/i18n/use-i18n';
import { workspaceDisplayName } from '@/utils/workspace';
import type { PermissionSettingsSnapshot } from '@octopus/shared/protocol';

/**
 * Keep scope selection local to each full-page or modal Settings surface.
 */
export function PermissionsPage() {
  const { t } = useI18n();
  const workspaces = useWorkspaces();
  const [selected, setSelected] = useState('');
  const [scope, setScope] = useState('global');
  const workspaceId = selected || workspaces.data?.[0]?.id;
  return (
    <SettingContainer
      classNames={{ container: 'p-0 md:p-0', content: 'min-h-full max-w-5xl gap-5 px-4 py-5 md:px-6' }}
    >
      <Tabs value={scope} onValueChange={(value) => setScope(String(value))} className="gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <PageTabList
            aria-label="Permission configuration scope"
            className="shrink-0"
            items={[
              { value: 'global', label: t('settings.permissions.scopeGlobal', 'Global') },
              { value: 'workspace', label: t('settings.permissions.scopeWorkspace', 'Workspace') },
            ]}
          />
          {scope === 'workspace' && workspaces.isSuccess && workspaceId ? (
            <div className="min-w-0 max-w-56 flex-1">
              <PermissionSelect
                label={t('settings.permissions.selectWorkspace', 'Select workspace')}
                value={workspaceId}
                onChange={setSelected}
                items={workspaces.data.map((workspace) => ({
                  value: workspace.id,
                  label: workspaceDisplayName(t, workspace),
                }))}
              />
            </div>
          ) : null}
        </div>
        <TabsContent value="global">
          <PermissionScopePanel />
        </TabsContent>
        <TabsContent value="workspace">
          {workspaces.isPending ? (
            <Spinner />
          ) : workspaces.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                {t('settings.permissions.workspacesFailed', 'Failed to load workspaces.')}
                <Button variant="link" onClick={() => void workspaces.refetch()}>
                  {t('common.retry', 'Retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : workspaceId ? (
            <PermissionScopePanel key={workspaceId} workspaceId={workspaceId} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('settings.permissions.noWorkspace', 'No workspaces yet; create one first.')}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </SettingContainer>
  );
}

/**
 * Capture editor revisions explicitly so background refreshes never overwrite unsaved drafts.
 */
function PermissionScopePanel({ workspaceId }: { workspaceId?: string }) {
  const { t } = useI18n();
  const kindLabels = getKindLabels(t);
  const modeLabels = getModeLabels(t);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{
    snapshot: PermissionSettingsSnapshot;
    type: 'general' | 'json' | 'tool';
    tool?: string;
  }>();
  const query = useQuery({
    queryKey: ['permission-settings', workspaceId ?? 'global'],
    queryFn: ({ signal }) => getPermissionSettings(workspaceId, signal),
  });
  const snapshot = query.data;
  const config = snapshot?.effective;
  const names = config
    ? [
        ...new Set([
          ...Object.keys(config.toolRules),
          ...Object.keys(snapshot?.overrides?.toolRules ?? {}),
          ...Object.keys(config.policy.tools),
          ...Object.values(config.modes).flatMap((mode) => Object.keys(mode.tools)),
        ]),
      ]
        .sort()
        .filter((name) => name.toLowerCase().includes(search.toLowerCase()))
    : [];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {snapshot && (
          <p
            className="min-w-0 flex-1 break-all text-xs text-muted-foreground font-geist truncate"
            title={snapshot.path}
          >
            {snapshot.path}
          </p>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh permission configuration"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? <Spinner /> : <RefreshCwIcon className="size-3.5" />}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={!snapshot}
          onClick={() => snapshot && setEditor({ snapshot, type: 'json' })}
        >
          <CodeIcon />
          {t('settings.permissions.jsonConfig', 'JSON configuration')}
        </Button>
        {snapshot ? (
          <PermissionResetButton snapshot={snapshot} workspaceId={workspaceId} disabled={query.isFetching} />
        ) : null}
      </div>
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('settings.permissions.loadFailed', 'Failed to load')}</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {query.isPending ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner />
          {t('settings.permissions.loading', 'Loading permission configuration…')}
        </div>
      ) : null}
      {snapshot?.diagnostics.map((item) => (
        <Alert variant="destructive" key={item.path}>
          <AlertTitle>{t('settings.permissions.invalidTitle', 'Invalid configuration')}</AlertTitle>
          <AlertDescription>
            {t('settings.permissions.invalidDescription', '{{message}}. Fix via JSON configuration: {{path}}', {
              message: item.message,
              path: item.path,
            })}
          </AlertDescription>
        </Alert>
      ))}
      {config && snapshot ? (
        <>
          <div className="rounded-xl border p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">{t('settings.permissions.modesTitle', 'Permission run modes')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    'settings.permissions.modesDescription',
                    'Configure default permissions by tool kind for Ask, Auto-approve and Full access modes.'
                  )}
                </p>
              </div>
              <Button variant="default" size="sm" onClick={() => setEditor({ snapshot, type: 'general' })}>
                <PencilIcon />
                {t('common.edit', 'Edit')}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['ask', 'auto', 'full'] as const).map((mode) => (
                <div key={mode} className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-2 text-sm font-medium">{modeLabels[mode]}</p>
                  {Object.entries(kindLabels).map(([kind, label]) => (
                    <div key={kind} className="flex justify-between gap-3 text-xs leading-6">
                      <span className="text-muted-foreground">{label}</span>
                      <span>
                        <PermissionActionBadge
                          action={
                            kind === 'external'
                              ? config.modes[mode].external
                              : config.modes[mode].kinds[kind as keyof typeof config.modes.ask.kinds]
                          }
                        />
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <PermissionAuditCard
            snapshot={snapshot}
            workspaceId={workspaceId}
            key={`${workspaceId ?? 'global'}:${snapshot.revision}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              resultCount={names.length}
              aria-label="Search tool rules"
              placeholder={t('settings.permissions.searchPlaceholder', 'Search tool names…')}
              className="min-w-0 flex-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button onClick={() => setEditor({ snapshot, type: 'tool' })}>
              <PlusIcon />
              {t('settings.permissions.addRule', 'Add tool rule')}
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.permissions.table.tool', 'Tool')}</TableHead>
                  <TableHead>{t('settings.permissions.table.kind', 'Kind')}</TableHead>
                  <TableHead>{t('settings.permissions.table.policy', 'Fixed policy')}</TableHead>
                  <TableHead>{t('settings.permissions.table.source', 'Source')}</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">{t('settings.permissions.table.actions', 'Actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {names.map((name) => {
                  const overridden =
                    Object.hasOwn(snapshot.overrides?.toolRules ?? {}, name) ||
                    Object.hasOwn(snapshot.overrides?.policy?.tools ?? {}, name) ||
                    Object.values(snapshot.overrides?.modes ?? {}).some((mode) =>
                      Object.hasOwn(mode.tools ?? {}, name)
                    );
                  return (
                    <TableRow key={name}>
                      <TableCell className="max-w-64 truncate font-mono text-xs" title={name}>
                        {name}
                      </TableCell>
                      <TableCell>{kindLabels[config.toolRules[name]?.kind ?? 'custom']}</TableCell>
                      <TableCell>
                        <PermissionActionBadge action={config.policy.tools[name]} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={overridden ? 'secondary' : 'outline'}>
                          {overridden
                            ? t('settings.permissions.sourceCustom', 'Custom')
                            : t('settings.permissions.sourceDefault', 'Default')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${name}`}
                          onClick={() => setEditor({ snapshot, type: 'tool', tool: name })}
                        >
                          <PencilIcon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {names.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      {t('settings.permissions.noMatch', 'No matching tool rules')}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              'settings.permissions.footerNote',
              'Unconfigured tools are treated as "other tools". Fixed policy takes precedence over mode rules, denial over session approval; outside-workspace operations are judged separately.'
            )}
          </p>
        </>
      ) : null}
      {editor?.type === 'tool' ? (
        <PermissionToolEditor
          snapshot={editor.snapshot}
          workspaceId={workspaceId}
          tool={editor.tool}
          onClose={() => setEditor(undefined)}
        />
      ) : editor ? (
        <PermissionConfigEditor
          snapshot={editor.snapshot}
          workspaceId={workspaceId}
          mode={editor.type}
          onClose={() => setEditor(undefined)}
        />
      ) : null}
    </div>
  );
}
