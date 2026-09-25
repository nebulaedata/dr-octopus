/**
 * @author GitHub Copilot
 * @description Renders a lazily-expanding Workspace directory tree backed by the file explorer store.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircleIcon,
  ChevronRightIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  ListCollapseIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Input } from '@octopus/ui/components/input';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { getWorkspaceFileDownloadUrl, getWorkspaceFileImageUrl } from '@/api/workspace';
import { ImagePreviewDialog } from '@/components/ImagePreviewDialog';
import { useI18n } from '@/i18n/use-i18n';
import { useFileExplorerStore } from '@/stores/file-explorer';
import { download } from '@/utils/common';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { FileEditorDialog } from './FileEditorDialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import type { FileTreeEntryType } from '@octopus/shared/protocol';
import type { WorkspaceFileTreeState } from '@/stores/file-explorer';

export interface ExplorerFileTreeProps {
  workspaceId: string;
}

interface CreationTarget {
  parentPath?: string;
  type: FileTreeEntryType;
}

/**
 * Matches image formats supported by the Workspace's validated inline image endpoint.
 */
function isPreviewableImage(path: string): boolean {
  return /\.(?:png|jpe?g|webp)$/i.test(path);
}

/**
 * Resolves the directory a toolbar action should target from the current selection: the selected
 * directory itself, the parent of a selected file, or the Workspace root when nothing is selected.
 */
function resolveTargetDirectory(
  workspace: WorkspaceFileTreeState | undefined,
  selectedPaths: string[]
): string | undefined {
  const path = selectedPaths[0];
  const node = path === undefined ? undefined : workspace?.nodesByPath[path];
  if (node === undefined) {
    return undefined;
  }
  if (node.entry.type === 'directory') {
    return path;
  }
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? undefined : path.slice(0, lastSlash);
}

/**
 * Loads and renders the root of a Workspace file tree, keyed by Workspace so switching sessions reuses the cache.
 */
export function ExplorerFileTree({ workspaceId }: ExplorerFileTreeProps) {
  const { t } = useI18n();
  const workspace = useFileExplorerStore((state) => state.workspaces[workspaceId]);
  const loadRoot = useFileExplorerStore((state) => state.loadRoot);
  const expandDirectory = useFileExplorerStore((state) => state.expandDirectory);
  const setExpanded = useFileExplorerStore((state) => state.setExpanded);
  const collapseAll = useFileExplorerStore((state) => state.collapseAll);
  const createEntry = useFileExplorerStore((state) => state.createEntry);
  const deleteEntries = useFileExplorerStore((state) => state.deleteEntries);
  const uploadFiles = useFileExplorerStore((state) => state.uploadFiles);
  const refreshAll = useFileExplorerStore((state) => state.refreshAll);

  const [creating, setCreating] = useState<CreationTarget | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [previewingPath, setPreviewingPath] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadRoot(workspaceId);
  }, [loadRoot, workspaceId]);

  if (workspace === undefined) {
    return (
      <div className="flex items-center h-full py-8 pb-50">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpenIcon />
            </EmptyMedia>
            <EmptyTitle>{t('session.explorer.noWorkspaceTitle', 'No workspace yet')}</EmptyTitle>
            <EmptyDescription>
              {t('session.explorer.noWorkspaceDescription', 'This workspace has not been set up yet.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  if (workspace.rootError !== undefined) {
    return (
      <div className="p-3">
        <Alert variant="destructive" aria-busy={workspace.rootLoading}>
          <AlertCircleIcon />
          <AlertTitle>{t('session.explorer.loadFailedTitle', 'Failed to load files')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              {/timeout|timed out|超时/i.test(workspace.rootError)
                ? t('session.explorer.loadTimeout', 'Loading timed out. Please try again later.')
                : t(
                    'session.explorer.loadFailedDescription',
                    'Unable to fetch workspace files. Please try again.'
                  )}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={workspace.rootLoading}
              onClick={() => void loadRoot(workspaceId)}
            >
              {workspace.rootLoading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              {workspace.rootLoading
                ? t('session.explorer.retrying', 'Retrying…')
                : t('common.retry', 'Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const selectedPaths = workspace.selectedPaths;
  const selectedNode = selectedPaths.length === 1 ? workspace.nodesByPath[selectedPaths[0]] : undefined;
  const canOpenSelected = selectedNode?.entry.type === 'file';
  const selectedIsImage = canOpenSelected && isPreviewableImage(selectedPaths[0]);

  /**
   * Routes supported image files to the viewer and other files to the text editor.
   */
  function openFile(path: string) {
    if (isPreviewableImage(path)) {
      setPreviewingPath(path);
    } else {
      setEditingPath(path);
    }
  }

  /**
   * Begins an inline create flow, expanding and loading the target directory first when needed.
   */
  async function beginCreate(type: FileTreeEntryType) {
    const parentPath = resolveTargetDirectory(workspace, selectedPaths);
    if (parentPath !== undefined) {
      await expandDirectory(workspaceId, parentPath);
      setExpanded(workspaceId, parentPath, true);
    }
    setCreating({ parentPath, type });
  }

  /**
   * Uploads the files chosen via the hidden file input into the resolved target directory.
   */
  async function handleUploadChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }
    const targetDir = resolveTargetDirectory(workspace, selectedPaths);
    if (targetDir !== undefined) {
      await expandDirectory(workspaceId, targetDir);
      setExpanded(workspaceId, targetDir, true);
    }
    await uploadFiles(workspaceId, targetDir, files);
  }

  /**
   * Downloads the single selected entry.
   */
  function handleDownload() {
    if (selectedPaths.length !== 1) {
      return;
    }
    download(getWorkspaceFileDownloadUrl(workspaceId, selectedPaths[0]));
  }

  /**
   * Clears the Workspace's lazy-load cache and reloads only the root.
   */
  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshAll(workspaceId);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col h-full gap-0.5">
      <div aria-label="toolbar" className="flex-none flex items-center gap-2 px-5 py-1">
        <div className="flex items-center overflow-hidden">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Collapse All"
                  onClick={() => collapseAll(workspaceId)}
                >
                  <ListCollapseIcon />
                </Button>
              }
            />
            <TooltipContent>{t('session.explorer.collapseAll', 'Collapse All')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New File"
                  onClick={() => void beginCreate('file')}
                >
                  <FilePlusIcon />
                </Button>
              }
            />
            <TooltipContent>{t('session.explorer.newFile', 'New File')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New Folder"
                  onClick={() => void beginCreate('directory')}
                >
                  <FolderPlusIcon />
                </Button>
              }
            />
            <TooltipContent>{t('session.explorer.newFolder', 'New Folder')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Upload File"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadIcon />
                </Button>
              }
            />
            <TooltipContent>{t('session.explorer.uploadFile', 'Upload File')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Download File"
                  disabled={selectedPaths.length !== 1}
                  onClick={handleDownload}
                >
                  <DownloadIcon />
                </Button>
              }
            />
            <TooltipContent>{t('session.explorer.downloadFile', 'Download File')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={selectedIsImage ? 'Preview image' : 'Edit file'}
                  disabled={!canOpenSelected}
                  onClick={() => canOpenSelected && openFile(selectedPaths[0])}
                >
                  {selectedIsImage ? <EyeIcon /> : <PencilIcon />}
                </Button>
              }
            />
            <TooltipContent>
              {selectedIsImage
                ? t('session.explorer.previewImage', 'Preview image')
                : t('session.explorer.editFile', 'Edit File')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete File"
                  disabled={selectedPaths.length === 0}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <TrashIcon className="text-destructive" />
                </Button>
              }
            />
            <TooltipContent>{t('session.explorer.deleteFile', 'Delete File')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Refresh File"
                  disabled={refreshing}
                  onClick={() => void handleRefresh()}
                >
                  <RefreshCwIcon className={refreshing ? 'animate-spin' : undefined} />
                </Button>
              }
            />
            <TooltipContent>{t('session.explorer.refreshFile', 'Refresh File')}</TooltipContent>
          </Tooltip>
        </div>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          onChange={(event) => void handleUploadChange(event)}
        />
      </div>
      <ScrollArea aria-label="content" className="flex-1 min-h-0 px-5">
        {workspace.rootLoading ? (
          <div className="flex justify-center items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {t('session.explorer.loadingFiles', 'Loading files…')}
          </div>
        ) : (
          <>
            {creating !== null && creating.parentPath === undefined && (
              <CreateEntryRow
                depth={0}
                type={creating.type}
                onSubmit={async (name) => {
                  await createEntry(workspaceId, undefined, name, creating.type);
                  setCreating(null);
                }}
                onCancel={() => setCreating(null)}
              />
            )}
            {workspace.rootPaths.length === 0 && creating === null ? (
              <div className="flex items-center h-full py-8 pb-50">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FolderOpenIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t('session.explorer.noFilesTitle', 'No files yet')}</EmptyTitle>
                    <EmptyDescription>
                      {t('session.explorer.noFilesDescription', "You haven't created any files yet.")}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : (
              workspace.rootPaths.map((path) => (
                <FileTreeEntryItem
                  key={path}
                  workspaceId={workspaceId}
                  path={path}
                  depth={0}
                  creating={creating}
                  onSubmitCreate={async (parentPath, name, type) => {
                    await createEntry(workspaceId, parentPath, name, type);
                    setCreating(null);
                  }}
                  onCancelCreate={() => setCreating(null)}
                  onOpenFile={openFile}
                />
              ))
            )}
          </>
        )}
      </ScrollArea>
      <DeleteEntriesDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        count={selectedPaths.length}
        onConfirm={async () => {
          await deleteEntries(workspaceId, selectedPaths);
          setDeleteDialogOpen(false);
        }}
      />
      {editingPath !== null && (
        <FileEditorDialog workspaceId={workspaceId} path={editingPath} onClose={() => setEditingPath(null)} />
      )}
      {previewingPath !== null && (
        <ImagePreviewDialog
          open
          onOpenChange={(open) => !open && setPreviewingPath(null)}
          src={getWorkspaceFileImageUrl(workspaceId, previewingPath)}
          title={previewingPath.split('/').at(-1) ?? previewingPath}
          description={previewingPath}
        />
      )}
    </div>
  );
}

interface CreateEntryRowProps {
  depth: number;
  type: FileTreeEntryType;
  onSubmit(name: string): Promise<void>;
  onCancel(): void;
}

/**
 * Renders an inline text input for naming a new file or folder at its future position in the tree.
 */
function CreateEntryRow({ depth, type, onSubmit, onCancel }: CreateEntryRowProps) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * Validates the trimmed name and delegates creation, keeping the row open with an error on failure.
   */
  async function submit() {
    const name = value.trim();
    if (name.length === 0 || name.includes('/') || name.includes('\\')) {
      setError(t('session.explorer.invalidName', 'Enter a valid name.'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('session.explorer.createFailed', 'Failed to create entry.')
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 14 + 8}px` }}>
      {type === 'file' ? (
        <FileIcon className="size-4 shrink-0" />
      ) : (
        <FolderIcon className="size-4 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Input
          ref={inputRef}
          className="h-6 px-1.5 py-0 text-sm"
          value={value}
          disabled={submitting}
          onChange={(event) => setValue(event.target.value)}
          onBlur={onCancel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        {error !== null && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}

interface DeleteEntriesDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  count: number;
  onConfirm(): Promise<void>;
}

/**
 * Confirms a (possibly batched) recursive delete of the currently selected Workspace entries.
 */
function DeleteEntriesDialog({ open, onOpenChange, count, onConfirm }: DeleteEntriesDialogProps) {
  const { t } = useI18n();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Runs the confirmed delete and surfaces any failure inline instead of closing the dialog.
   */
  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('session.explorer.deleteFailed', 'Failed to delete.'));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {count > 1
              ? t('session.explorer.deleteTitleMany', 'Delete {{count}} items', { count })
              : t('session.explorer.deleteTitleOne', 'Delete item')}
          </DialogTitle>
          <DialogDescription>
            {count > 1
              ? t(
                  'session.explorer.deleteDescriptionMany',
                  'Are you sure you want to delete these {{count}} items? Folders are removed along with all of their contents. This action cannot be undone.',
                  { count }
                )
              : t(
                  'session.explorer.deleteDescriptionOne',
                  'Are you sure you want to delete this item? Folders are removed along with all of their contents. This action cannot be undone.'
                )}
          </DialogDescription>
        </DialogHeader>
        {error !== null && <p className="text-sm font-medium text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void handleDelete()} disabled={isDeleting}>
            {isDeleting
              ? t('session.explorer.deleting', 'Deleting…')
              : t('session.explorer.delete', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Renders one file or directory node, recursing into its cached children while collapsed content stays unmounted.
 */
function FileTreeEntryItem({
  workspaceId,
  path,
  depth,
  creating,
  onSubmitCreate,
  onCancelCreate,
  onOpenFile,
}: {
  workspaceId: string;
  path: string;
  depth: number;
  creating: CreationTarget | null;
  onSubmitCreate(parentPath: string, name: string, type: FileTreeEntryType): Promise<void>;
  onCancelCreate(): void;
  onOpenFile(path: string): void;
}) {
  const { t } = useI18n();
  const node = useFileExplorerStore((state) => state.workspaces[workspaceId]?.nodesByPath[path]);
  const expandDirectory = useFileExplorerStore((state) => state.expandDirectory);
  const isExpanded = useFileExplorerStore(
    (state) => state.workspaces[workspaceId]?.expandedPaths[path] ?? false
  );
  const setExpanded = useFileExplorerStore((state) => state.setExpanded);
  const isSelected = useFileExplorerStore(
    (state) => state.workspaces[workspaceId]?.selectedPaths.includes(path) ?? false
  );
  const selectPath = useFileExplorerStore((state) => state.selectPath);

  if (node === undefined) {
    return null;
  }

  const indentStyle = { paddingLeft: `${depth * 14 + 8}px` };
  const selectedClassName = isSelected ? 'bg-accent text-accent-foreground' : '';
  // Selected state must win over the ghost variant's hover/aria-expanded backgrounds, so it's applied exclusively per branch.
  const folderClassName = isSelected
    ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground'
    : 'hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground';

  if (node.entry.type === 'file') {
    return (
      <Button
        variant="link"
        size="sm"
        className={cn(
          'w-full justify-start gap-2 text-foreground no-underline hover:no-underline',
          selectedClassName
        )}
        style={indentStyle}
        title={node.entry.name}
        onClick={(event) => selectPath(workspaceId, path, event.ctrlKey || event.metaKey)}
        onDoubleClick={() => onOpenFile(path)}
      >
        <FileIcon />
        <span className="min-w-0 flex-1 truncate text-left">{node.entry.name}</span>
      </Button>
    );
  }

  /**
   * Selects renderdiv content in the existing condition order.
   */
  function renderContent() {
    if (node.error !== undefined) {
      return (
        <div className="p-2" style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}>
          <Alert variant="destructive" aria-busy={node.loading}>
            <AlertCircleIcon />
            <AlertTitle>{t('session.explorer.dirLoadFailedTitle', 'Failed to load directory')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>
                {t(
                  'session.explorer.dirLoadFailedDescription',
                  'Unable to read this directory. Please try again.'
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={node.loading}
                onClick={() => void expandDirectory(workspaceId, path)}
              >
                {node.loading ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                {node.loading ? t('session.explorer.retrying', 'Retrying…') : t('common.retry', 'Retry')}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    } else if (node.loaded && node.childPaths?.length === 0) {
      return (
        <p
          className="py-1 text-xs text-muted-foreground"
          style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}
        >
          {t('session.explorer.emptyDirectory', 'This directory is empty')}
        </p>
      );
    } else {
      return null;
    }
  }
  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={(open) => {
        setExpanded(workspaceId, path, open);
        if (open) {
          void expandDirectory(workspaceId, path);
        }
      }}
    >
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn('group w-full justify-start gap-1.5 transition-none', folderClassName)}
            style={indentStyle}
            title={node.entry.name}
            onClick={(event) => selectPath(workspaceId, path, event.ctrlKey || event.metaKey)}
          >
            {node.loading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ChevronRightIcon className="transition-transform group-aria-expanded:rotate-90" />
            )}
            <FolderIcon />
            <span className="min-w-0 flex-1 truncate text-left">{node.entry.name}</span>
          </Button>
        }
      />
      <CollapsibleContent keepMounted={false}>
        {isExpanded ? (
          <div className="flex flex-col gap-0.5">
            {renderContent()}
            {creating?.parentPath === path && (
              <CreateEntryRow
                depth={depth + 1}
                type={creating.type}
                onSubmit={(name) => onSubmitCreate(path, name, creating.type)}
                onCancel={onCancelCreate}
              />
            )}
            {node.childPaths?.map((childPath) => (
              <FileTreeEntryItem
                key={childPath}
                workspaceId={workspaceId}
                path={childPath}
                depth={depth + 1}
                creating={creating}
                onSubmitCreate={onSubmitCreate}
                onCancelCreate={onCancelCreate}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
