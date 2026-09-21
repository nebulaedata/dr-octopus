/**
 * @author Codex
 * @description Displays ordinary Session knowledge scope and delegates configuration changes to Agent controls.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpenIcon, CheckIcon, CopyXIcon, GlobeIcon, Settings2Icon, SparklesIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { ListPagination } from '@/components/ListPagination';
import { Badge } from '@octopus/ui/components/badge';
import { Alert, AlertDescription } from '@octopus/ui/components/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@octopus/ui/components/dialog';
import { ToggleGroup, ToggleGroupItem } from '@octopus/ui/components/toggle-group';
import { Tabs } from '@octopus/ui/components/tabs';
import { PageTabList } from '@/components/PageTabList';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@octopus/ui/components/command';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { listKnowledgeCollections } from '@/api/knowledge';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeModeConfig, KnowledgeModeState } from '@octopus/shared/protocol/knowledge';

interface KnowledgeModeBarProps {
  workspaceId: string;
  state: KnowledgeModeState;
  disabled: boolean;
  /**
   * Forward configuration while retaining the authoritative state until Agent acknowledgement.
   */
  onChange(config: KnowledgeModeConfig): void;
}

/**
 * Keep mode guidance and scope controls close to the same conversation's Composer.
 */
export function KnowledgeModeBar({ workspaceId, state, disabled, onChange }: KnowledgeModeBarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pb-3">
      <BookOpenIcon className="size-4 text-muted-foreground" />
      <span className="text-sm font-medium font-serif">
        {t('session.knowledgeMode.title', 'Knowledge Q&A')}
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline font-serif">
        {t('session.knowledgeMode.subtitle', 'Search sources · answers with citations')}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Badge variant="secondary" className="text-[11px] text-muted-foreground">
          {state.collectionIds.length
            ? t('session.knowledgeMode.selectedBadge', 'Selected collections ({{count}})', {
                count: state.collectionIds.length,
              })
            : t('session.knowledgeMode.autoBadge', 'Auto-match sources')}
        </Badge>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                title={t('session.knowledgeMode.settingsTitle', 'Source settings')}
              />
            }
          >
            <Settings2Icon />
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {t('session.knowledgeMode.dialogTitle', 'Source answers from the right materials')}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'session.knowledgeMode.dialogDescription',
                  'By default the Agent matches collections; once sources are specified, retrieval stays within the selected scope.'
                )}
              </DialogDescription>
            </DialogHeader>
            {open && (
              <KnowledgeScopeEditor
                workspaceId={workspaceId}
                state={state}
                disabled={disabled}
                onChange={(config) => {
                  onChange(config);
                  setOpen(false);
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

/**
 * Stage source selection locally; paging never discards selections from other pages or scopes.
 */
function KnowledgeScopeEditor({ workspaceId, state, disabled, onChange }: KnowledgeModeBarProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(state.collectionIds);
  const [selectionMode, setSelectionMode] = useState(state.collectionIds.length ? 'selected' : 'auto');
  const [scope, setScope] = useState('workspace');
  const [page, setPage] = useState(1);
  const collections = useQuery({
    queryKey: ['knowledge', scope === 'global' ? 'global' : workspaceId, 'collections', page],
    queryFn: ({ signal }) =>
      listKnowledgeCollections(scope === 'global' ? undefined : workspaceId, page, signal),
    enabled: selectionMode === 'selected',
  });
  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        value={[selectionMode]}
        onValueChange={(value) => {
          if (value[0]) {
            setSelectionMode(value[0]);
          }
        }}
        variant="outline"
        className="w-full"
      >
        <ToggleGroupItem value="auto" className="flex-1">
          <SparklesIcon />
          {t('session.knowledgeMode.auto', 'Auto-match')}
        </ToggleGroupItem>
        <ToggleGroupItem value="selected" className="flex-1">
          <BookOpenIcon />
          {t('session.knowledgeMode.selected', 'Selected collections')}
        </ToggleGroupItem>
      </ToggleGroup>
      {selectionMode === 'auto' ? (
        <Alert>
          <SparklesIcon />
          <AlertDescription>
            {t(
              'session.knowledgeMode.autoDescription',
              'The Agent picks relevant materials from the current workspace and global knowledge bases, and confirms with you first when the topic is unclear.'
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Tabs
              value={scope}
              onValueChange={(value) => {
                setScope(value);
                setPage(1);
              }}
            >
              <PageTabList
                items={[
                  { value: 'workspace', label: t('session.knowledgeMode.scopeWorkspace', 'Workspace') },
                  { value: 'global', label: t('session.knowledgeMode.scopeGlobal', 'Global'), icon: GlobeIcon },
                ]}
              />
            </Tabs>
            <Badge variant="outline">
              {t('session.knowledgeMode.selectedCount', 'Selected {{count}} / 20', { count: selected.length })}
            </Badge>
          </div>
          {collections.isPending ? (
            <Skeleton className="h-44 w-full" />
          ) : collections.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                {collections.error.message}
                <Button variant="link" onClick={() => void collections.refetch()}>
                  {t('common.retry', 'Retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <Command className="border">
              <CommandInput
                placeholder={t('session.knowledgeMode.filterPlaceholder', 'Filter collections on this page…')}
              />
              <CommandList className="h-52">
                <CommandEmpty>
                  {t('session.knowledgeMode.emptyPage', 'No matching collections on this page')}
                </CommandEmpty>
                <CommandGroup>
                  {collections.data?.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.name} ${item.description} ${item.id}`}
                      disabled={!selected.includes(item.id) && selected.length >= 20}
                      onSelect={() =>
                        setSelected(
                          selected.includes(item.id)
                            ? selected.filter((id) => id !== item.id)
                            : [...selected, item.id]
                        )
                      }
                    >
                      <BookOpenIcon />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{item.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.description ||
                            (item.source === 'remote'
                              ? t('session.knowledgeMode.remoteFallback', 'Remote shared materials')
                              : t('session.knowledgeMode.localFallback', 'Local knowledge collection'))}
                        </p>
                      </div>
                      {selected.includes(item.id) && (
                        <CheckIcon
                          aria-label="Selected"
                        />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected([])} disabled={!selected.length}>
              <CopyXIcon data-icon="inline-start" />
              {t('session.knowledgeMode.clearSelection', 'Clear selection')}
            </Button>
            <ListPagination
              aria-label="Knowledge source pagination"
              className="w-auto"
              compact
              page={page}
              pageCount={Math.max(1, Math.ceil((collections.data?.total ?? 0) / 20))}
              disabled={collections.isFetching}
              onPageChange={setPage}
            />
          </div>
        </div>
      )}
      <DialogFooter>
        <Button
          disabled={disabled || (selectionMode === 'selected' && !selected.length)}
          onClick={() => onChange({ collectionIds: selectionMode === 'auto' ? [] : selected })}
        >
          {t('session.knowledgeMode.apply', 'Apply source settings')}
        </Button>
      </DialogFooter>
    </div>
  );
}
