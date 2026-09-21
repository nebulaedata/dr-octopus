/**
 * @author Codex
 * @description Presents a Workspace text file in a theme-aware Monaco editor and persists explicit saves.
 */

import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Spinner } from '@octopus/ui/components/spinner';
import { cn } from '@octopus/ui/lib/utils';
import { CodeEditor } from '@/components/CodeEditor';
import { FileContentPreview } from '@/components/FileContentPreview';
import { ToggleButtonGroup } from '@/components/ToggleButtonGroup';
import { useUpdateWorkspaceFileContent, useWorkspaceFileContent } from '@/queries/workbench-queries';
import { useI18n } from '@/i18n/use-i18n';
import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import type { FileContentPreviewKind } from '@/components/FileContentPreview';

export interface FileEditorDialogProps {
  workspaceId: string;
  path: string;
  /**
   * Closes the editor without persisting an unsaved buffer.
   */
  onClose(): void;
}

const FILE_PREVIEW_KINDS: Record<string, FileContentPreviewKind> = {
  '.md': 'markdown',
  '.html': 'html',
  '.htm': 'html',
};

type FileView = 'editor' | 'preview';

/**
 * Returns the normalized extension used to select an optional file preview.
 */
function getFileExtension(path: string): string {
  const fileName = path.split('/').at(-1) ?? '';
  const extensionStart = fileName.lastIndexOf('.');
  return extensionStart > 0 ? fileName.slice(extensionStart).toLowerCase() : '';
}

/**
 * Owns file loading and the accessible Dialog shell around the editor.
 */
export function FileEditorDialog({ workspaceId, path, onClose }: FileEditorDialogProps) {
  const { t } = useI18n();
  const file = useWorkspaceFileContent(workspaceId, path);
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          'h-[min(85vh,900px)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-6xl',
          isFullscreen &&
            'top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none sm:max-w-none'
        )}
      >
        <Button
          className="absolute top-2 right-10"
          variant="ghost"
          size="icon-sm"
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          title={
            isFullscreen
              ? t('session.fileEditor.exitFullscreen', 'Exit full screen')
              : t('session.fileEditor.enterFullscreen', 'Enter full screen')
          }
          onClick={() => setIsFullscreen((fullscreen) => !fullscreen)}
        >
          {isFullscreen ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
        </Button>
        <DialogHeader>
          <DialogTitle className="truncate">{path.split('/').at(-1)}</DialogTitle>
          <DialogDescription className="truncate">{path}</DialogDescription>
        </DialogHeader>
        {file.isPending ? (
          <div className="flex min-h-0 items-center justify-center gap-2 text-muted-foreground">
            <Spinner />
            {t('session.fileEditor.loading', 'Loading file…')}
          </div>
        ) : file.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('session.fileEditor.openFailed', 'Unable to open file')}</AlertTitle>
            <AlertDescription>{file.error.message}</AlertDescription>
          </Alert>
        ) : (
          <FileEditor workspaceId={workspaceId} path={path} initialContent={file.data} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FileEditorProps {
  workspaceId: string;
  path: string;
  initialContent: string;
  /**
   * Closes the enclosing Dialog after cancellation or a successful save.
   */
  onClose(): void;
}

/**
 * Keeps the transient editor buffer separate from the cached server representation until save.
 */
function FileEditor({ workspaceId, path, initialContent, onClose }: FileEditorProps) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  const [view, setView] = useState<FileView>('editor');
  const saveFile = useUpdateWorkspaceFileContent(workspaceId, path);
  const isDirty = content !== initialContent;
  const extension = getFileExtension(path);
  const previewKind = FILE_PREVIEW_KINDS[extension];
  const supportsPreview = previewKind !== undefined;
  const fileViewOptions = [
    { key: 'editor', label: t('session.fileEditor.viewEditor', 'Editor') },
    { key: 'preview', label: t('session.fileEditor.viewPreview', 'Preview') },
  ] as const;

  /**
   * Persists the current editor buffer and closes only after a successful save.
   */
  async function handleSave() {
    try {
      await saveFile.mutateAsync(content);
      onClose();
    } catch {
      // Mutation state renders the transport error without discarding the buffer.
    }
  }

  return (
    <div className="-mx-4 -mb-4 flex min-h-0 min-w-0 flex-col">
      {supportsPreview ? (
        <ToggleButtonGroup<FileView>
          className="absolute top-6 right-25"
          options={fileViewOptions}
          selectedKey={view}
          ariaLabel="File view"
          onSelectedKeyChange={setView}
        />
      ) : null}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden border-y">
        {view === 'preview' && previewKind !== undefined ? (
          <FileContentPreview kind={previewKind}>{content}</FileContentPreview>
        ) : (
          <CodeEditor path={path} value={content} onChange={setContent} />
        )}
      </div>
      {saveFile.isError ? (
        <Alert variant="destructive" className="mx-4 w-auto">
          <AlertTitle>{t('session.fileEditor.saveFailed', 'Unable to save file')}</AlertTitle>
          <AlertDescription>{saveFile.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter className="mx-0 mb-0">
        <Button variant="outline" onClick={onClose} disabled={saveFile.isPending}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button onClick={() => void handleSave()} disabled={!isDirty || saveFile.isPending}>
          {saveFile.isPending
            ? t('session.fileEditor.saving', 'Saving…')
            : t('common.save', 'Save')}
        </Button>
      </DialogFooter>
    </div>
  );
}
