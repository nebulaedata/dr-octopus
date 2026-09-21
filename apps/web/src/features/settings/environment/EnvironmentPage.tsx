/**
 * @author Codex
 * @description Presents separate Server and Agent environment settings with source attribution and protected value editing.
 */
import { SettingContainer } from '../layout/SettingContainer';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BracesIcon, PencilIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { SearchInput } from '@/components/SearchInput';
import { Spinner } from '@octopus/ui/components/spinner';
import { Tabs, TabsContent } from '@octopus/ui/components/tabs';
import { PageTabList } from '@/components/PageTabList';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@octopus/ui/components/table';
import { getEnvironmentSettings } from '@/api/environment';
import { useI18n } from '@/i18n/use-i18n';
import { EnvironmentEditor } from './EnvironmentEditor';
import { environmentErrorMessage, getEnvironmentSourceLabels } from './environment-labels';
import type { EnvironmentEntryDto, EnvironmentScope, EnvironmentSettingsDto } from '@octopus/shared/protocol';

/**
 * Keeps environment scope selection local to this Settings surface.
 */
export function EnvironmentPage() {
  return (
    <SettingContainer
      classNames={{
        container: 'p-0 md:p-0',
        content: 'min-h-full max-w-5xl gap-5 px-4 py-5 md:px-6',
      }}
    >
      <Tabs defaultValue="server" className="gap-5">
        <PageTabList
          aria-label="Environment variable scopes"
          items={[
            { value: 'server', label: 'Server' },
            { value: 'agent', label: 'Agent' },
          ]}
        />
        <TabsContent value="server">
          <EnvironmentScopePanel scope="server" />
        </TabsContent>
        <TabsContent value="agent">
          <EnvironmentScopePanel scope="agent" />
        </TabsContent>
      </Tabs>
    </SettingContainer>
  );
}

/**
 * Fetches one scope and preserves an editor's original revision until it closes.
 */
function EnvironmentScopePanel({ scope }: { scope: EnvironmentScope }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ snapshot: EnvironmentSettingsDto; entry?: EnvironmentEntryDto }>();
  const query = useQuery({
    queryKey: ['environment-settings', scope],
    queryFn: ({ signal }) => getEnvironmentSettings(scope, signal),
  });
  const entries =
    query.data?.entries.filter((entry) => entry.key.toLowerCase().includes(search.toLowerCase())) ?? [];
  const sourceLabels = getEnvironmentSourceLabels(t);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Alert>
        <BracesIcon />
        <AlertTitle>
          {scope === 'server'
            ? t('settings.environment.alertServerTitle', 'Takes effect after restarting the Server')
            : t('settings.environment.alertAgentTitle', 'Newly started Agent processes read the new configuration')}
        </AlertTitle>
        <AlertDescription>
          {t(
            'settings.environment.priorityDescription',
            'Priority: launch arguments → process environment / dev .env → file configuration → defaults. The table shows the values used at the next load; running processes keep their current configuration.'
          )}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          resultCount={query.isSuccess ? entries.length : undefined}
          className="min-w-0 flex-1"
          aria-label="Search environment variables"
          placeholder={t('settings.environment.searchPlaceholder', 'Search variable names…')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh environment variables"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? <Spinner /> : <RefreshCwIcon />}
        </Button>
        {scope === 'agent' ? (
          <Button
            disabled={!query.data}
            onClick={() => {
              if (query.data) {
                setEditor({ snapshot: query.data });
              }
            }}
          >
            <PlusIcon data-icon="inline-start" />
            {t('settings.environment.addVariable', 'Add variable')}
          </Button>
        ) : null}
      </div>
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('settings.environment.loadFailed', 'Failed to load')}</AlertTitle>
          <AlertDescription>{environmentErrorMessage(t, query.error)}</AlertDescription>
        </Alert>
      ) : null}
      {query.isPending ? (
        <div role="status" className="flex items-center justify-center gap-2 py-12">
          <Spinner />
          {t('settings.environment.loading', 'Loading environment variables…')}
        </div>
      ) : query.data ? (
        <>
          <p className="break-all text-xs text-muted-foreground">
            {t('settings.environment.configFile', 'Configuration file: {{path}}', { path: query.data.path })}
          </p>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.environment.columnKey', 'Name')}</TableHead>
                  <TableHead>{t('settings.environment.columnValue', 'Next load value')}</TableHead>
                  <TableHead>{t('settings.environment.columnSource', 'Source')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('settings.environment.columnActions', 'Actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.key}>
                    <TableCell className="max-w-64 whitespace-normal">
                      <div className="flex flex-col gap-1">
                        <code className="break-all text-xs">{entry.key}</code>
                        {entry.hasStoredValue && entry.source !== 'file' ? (
                          <span className="text-xs text-muted-foreground">
                            {t('settings.environment.storedOverridden', 'Saved value is overridden')}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-40">
                      <span
                        className="block truncate font-mono text-xs"
                        title={entry.sensitive ? undefined : entry.resolvedValue}
                      >
                        {entry.sensitive
                          ? '••••••••'
                          : entry.resolvedValue === ''
                            ? t('settings.environment.emptyString', '(empty string)')
                            : (entry.resolvedValue ?? t('settings.environment.notSet', 'Not set'))}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{sourceLabels[entry.source]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${entry.key}`}
                        onClick={() => setEditor({ snapshot: query.data!, entry })}
                      >
                        <PencilIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      {t('settings.environment.noMatch', 'No matching environment variables')}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
      {editor ? (
        <EnvironmentEditor
          snapshot={editor.snapshot}
          entry={editor.entry}
          onClose={() => setEditor(undefined)}
        />
      ) : null}
    </div>
  );
}
