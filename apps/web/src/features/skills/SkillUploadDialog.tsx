/**
 * @author Claude Code
 * @description Presents the Skill file upload flow with drag-drop, conflict, and overwrite handling.
 */

import { useState } from 'react';
import { CloudUploadIcon, FileArchiveIcon, FileTextIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@octopus/ui/components/select';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { cn } from '@octopus/ui/lib/utils';
import { Upload } from '@/components/Upload';
import { useUploadSkill } from '@/queries/skills-queries';
import { ApiRequestError } from '@/utils/request';
import { formatBytes } from './utils';
import { useI18n } from '@/i18n/use-i18n';
import type { SkillScope } from '@/api/skills';
import type { DragEvent } from 'react';

const ACCEPTED_EXTENSIONS = /\.(md|zip)$/i;

export interface SkillUploadDialogProps {
  scope: SkillScope;
  /** Workspace display name used by the scope selector. */
  workspaceName?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onScopeKindChange?(kind: SkillScope['kind']): void;
}

/**
 * Renders the upload dialog that stages one .md or .zip file and resolves name conflicts inline.
 */
export function SkillUploadDialog({
  scope,
  workspaceName,
  open,
  onOpenChange,
  onScopeKindChange,
}: SkillUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const uploadSkill = useUploadSkill(scope);
  const { t } = useI18n();

  /**
   * Accepts one candidate file from the picker or drop zone when its extension is supported.
   */
  function acceptFile(candidate: File | undefined): void {
    setConflictMessage(null);
    if (candidate === undefined) {
      return;
    }
    if (!ACCEPTED_EXTENSIONS.test(candidate.name)) {
      setFile(null);
      setFileError(t('skills.uploadDialog.typeError', 'Only .md or .zip files are supported.'));
      return;
    }
    setFileError(null);
    setFile(candidate);
  }

  /**
   * Resets the staged file and dialog-local failure state.
   */
  function reset(): void {
    setFile(null);
    setFileError(null);
    setConflictMessage(null);
    setDragActive(false);
  }

  /**
   * Submits the staged file, offering an explicit overwrite retry on name conflicts.
   */
  async function submit(overwrite: boolean): Promise<void> {
    if (file === null) {
      return;
    }
    setConflictMessage(null);
    setFileError(null);
    try {
      const skill = await uploadSkill.mutateAsync({ file, overwrite });
      toast.add({
        title: t('skills.uploadDialog.uploadedTitle', 'Skill uploaded'),
        description: t('skills.common.effectiveNote', 'Skill {{name}} will take effect in new sessions.', {
          name: skill.name,
        }),
        type: 'success',
      });
      onOpenChange(false);
      reset();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'SKILL_ALREADY_EXISTS') {
        setConflictMessage(error.message);
        return;
      }
      setFileError(
        error instanceof Error
          ? error.message
          : t('skills.uploadDialog.uploadFailedFallback', 'Upload failed; please try again later.')
      );
    }
  }

  /**
   * Highlights the drop zone while a dragged file hovers it.
   */
  function handleDrag(event: DragEvent<HTMLDivElement>, active: boolean): void {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(active);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          reset();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('skills.common.uploadSkill', 'Upload skill')}</DialogTitle>
          <DialogDescription>
            {scope.kind === 'global'
              ? t(
                  'skills.uploadDialog.descriptionGlobal',
                  'Supports a single SKILL.md file or a .zip skill package containing SKILL.md; it takes effect for new sessions in all workspaces after upload.'
                )
              : t(
                  'skills.uploadDialog.descriptionWorkspace',
                  'Supports a single SKILL.md file or a .zip skill package containing SKILL.md; it takes effect only for new sessions in the current workspace after upload.'
                )}
          </DialogDescription>
        </DialogHeader>
        {onScopeKindChange !== undefined && (
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-sm font-medium">{t('skills.common.scope', 'Scope')}</span>
            <Select
              value={scope.kind}
              onValueChange={(value) => onScopeKindChange(value === 'global' ? 'global' : 'workspace')}
            >
              <SelectTrigger className="w-full" aria-label="Scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">
                  {workspaceName === undefined
                    ? t('skills.common.scopeWorkspaceItem', 'Workspace skill')
                    : t('skills.common.scopeWorkspaceItemNamed', 'Workspace skill ({{name}})', {
                        name: workspaceName,
                      })}
                </SelectItem>
                <SelectItem value="global">
                  {t('skills.common.scopeGlobalItem', 'Global skill (all workspaces)')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose or drag in a skill file"
          className={cn(
            'flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
            dragActive
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/60 hover:bg-muted/40'
          )}
          onDragOver={(event) => handleDrag(event, true)}
          onDragEnter={(event) => handleDrag(event, true)}
          onDragLeave={(event) => handleDrag(event, false)}
          onDrop={(event) => {
            handleDrag(event, false);
            acceptFile(event.dataTransfer.files[0]);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        >
          <Upload accept=".md,.zip" onChange={(event) => acceptFile(event.target.files?.[0])}>
            <span className="flex cursor-pointer flex-col items-center gap-2">
              <CloudUploadIcon className="size-8 text-muted-foreground" />
              <span className="text-sm font-medium">
                {t('skills.uploadDialog.dropHint', 'Click to choose a file, or drag it here')}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('skills.uploadDialog.dropFormats', '.md single skill file · .zip skill package (with resource files)')}
              </span>
            </span>
          </Upload>
        </div>
        {file !== null && (
          <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5">
            {file.name.toLowerCase().endsWith('.zip') ? (
              <FileArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove the selected file"
              disabled={uploadSkill.isPending}
              onClick={() => {
                setFile(null);
                setConflictMessage(null);
              }}
            >
              <XIcon />
            </Button>
          </div>
        )}
        {conflictMessage !== null && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>{t('skills.uploadDialog.conflictTitle', 'A skill with the same name already exists')}</AlertTitle>
            <AlertDescription>
              {conflictMessage}
              {' '}
              {t('skills.uploadDialog.conflictSuffix', 'Confirming will completely replace the original skill files.')}
            </AlertDescription>
          </Alert>
        )}
        {fileError !== null && <p className="text-sm font-medium text-destructive">{fileError}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          {conflictMessage === null ? (
            <Button disabled={file === null || uploadSkill.isPending} onClick={() => void submit(false)}>
              {uploadSkill.isPending && <Spinner data-icon="inline-start" />}
              {t('skills.uploadDialog.submit', 'Upload')}
            </Button>
          ) : (
            <Button variant="destructive" disabled={uploadSkill.isPending} onClick={() => void submit(true)}>
              {uploadSkill.isPending && <Spinner data-icon="inline-start" />}
              {t('skills.uploadDialog.submitOverwrite', 'Overwrite and upload')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
