/**
 * @author Codex
 * @description Renders one reusable Session navigation row and hosts its action context menu.
 */

import { useEffect, useRef, useState } from 'react';
import {
  EllipsisIcon,
  PanelRightOpenIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
  RotateCwIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { Button } from '@octopus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { formatRelativeTime } from '@/utils/date';
import { RenameSessionDialog } from '@/features/session';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { Label } from '@octopus/ui/components/label';
import { RuntimeStatus } from './RuntimeStatus';
import { SessionTitle } from './SessionTitle';
import { useI18n } from '@/i18n/use-i18n';
import { Spinner } from '@octopus/ui/components/spinner';
import type { Translate } from '@/i18n/use-i18n';
import type { DeleteSessionOptionsDto, RuntimeProjectionState, SessionDto } from '@octopus/shared/protocol';

/**
 * Maps one runtime projection state to its localized list label, passing future states through unchanged.
 */
function runtimeStateLabel(t: Translate, state: RuntimeProjectionState): string {
  switch (state) {
    case 'dormant':
      return t('layout.session.runtimeStatus.dormant', 'Dormant');
    case 'starting':
      return t('layout.session.runtimeStatus.starting', 'Starting');
    case 'idle':
      return t('layout.session.runtimeStatus.idle', 'Idle');
    case 'running':
      return t('layout.session.runtimeStatus.running', 'Running');
    case 'recovering':
      return t('layout.session.runtimeStatus.recovering', 'Recovering');
    case 'stopping':
      return t('layout.session.runtimeStatus.stopping', 'Stopping');
    case 'failed':
      return t('layout.session.runtimeStatus.failed', 'Failed');
    default:
      return state;
  }
}

export interface SessionListItemProps {
  onRestart(session: SessionDto): void;
  restarting?: boolean;
  session: SessionDto;
  active: boolean;
  onSelect(session: SessionDto): void;
  onRename(session: SessionDto, title: string): Promise<void>;
  onPinnedChange(session: SessionDto, pinned: boolean): Promise<void>;
  onDelete(session: SessionDto, options?: DeleteSessionOptionsDto): Promise<void>;
  onOpenPropertiesPanel(session: SessionDto): void;
}

/**
 * Renders a selectable Session row with hover pin and overflow actions.
 */
export function SessionListItem(props: SessionListItemProps) {
  const { t } = useI18n();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const runtimeState = props.session.runtime?.state ?? 'dormant';
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (props.active) {
      rowRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  }, [props.active]);

  return (
    <>
      <div
        ref={rowRef}
        className="group relative grid w-full grid-cols-[minmax(0,1fr)] items-center rounded-lg border border-transparent bg-transparent p-1 transition-colors hover:bg-muted data-[active=true]:border-primary/35 data-[active=true]:bg-accent"
        data-active={props.active}
      >
        {props.session.pinnedAt !== undefined && (
          <span aria-hidden="true" className="absolute left-0 w-1 h-6 rounded-r-full bg-primary" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-col gap-1 bg-transparent px-2 py-0.5 text-left text-foreground"
          title={props.session.title}
          onClick={() => props.onSelect(props.session)}
        >
          <span className="flex max-w-full items-center gap-2">
            <SessionTitle title={props.session.title} />
            {(props.session.notificationVersion ?? 0) > (props.session.readVersion ?? 0) && (
              <span
                role="img"
                aria-label="Unread messages"
                className="size-2 shrink-0 rounded-full bg-blue-500"
              />
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground capitalize [&_svg]:size-3">
            {props.session.execution ? (
              <span className="truncate">{t('layout.session.taskResult', 'Task result')}</span>
            ) : (
              <span className="inline-flex shrink-0" title={runtimeStateLabel(t, runtimeState)}>
                <span aria-hidden="true" className="inline-flex">
                  <RuntimeStatus state={runtimeState} />
                </span>
                <span className="sr-only">{runtimeStateLabel(t, runtimeState)}</span>
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span className="truncate">
              {formatRelativeTime(props.session.lastMessageAt ?? props.session.createdAt)}
            </span>
          </span>
        </button>
        <div className="pointer-events-none absolute inset-y-px right-1 flex items-center rounded-r-md bg-linear-to-r from-transparent via-muted via-[24px] to-muted pl-6 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-data-[active=true]:via-accent group-data-[active=true]:to-accent">
          <Button
            className="hover:bg-white/75 dark:hover:bg-black/75 hover:text-accent-foreground"
            variant="ghost"
            size="icon-sm"
            aria-label={props.session.pinnedAt === undefined ? 'Pin session' : 'Unpin session'}
            aria-pressed={props.session.pinnedAt !== undefined}
            title={
              props.session.pinnedAt === undefined
                ? t('layout.session.pin', 'Pin session')
                : t('layout.session.unpin', 'Unpin session')
            }
            onClick={() => void props.onPinnedChange(props.session, props.session.pinnedAt === undefined)}
          >
            {props.session.pinnedAt === undefined ? <PinIcon className="rotate-45" /> : <PinOffIcon />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  className="hover:bg-white/75 dark:hover:bg-black/75 hover:text-accent-foreground"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="More session actions"
                  title={t('layout.session.more', 'More')}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 max-w-52" sideOffset={4}>
              <DropdownMenuGroup>
                {!props.session.execution && !props.session.isDraft && (
                  <DropdownMenuItem
                    disabled={
                      props.restarting ||
                      props.session.runtimeControl?.restart.status === 'restarting' ||
                      props.session.runtimeControl?.restart.error?.retryable === false
                    }
                    onClick={() => props.onRestart(props.session)}
                  >
                    <RotateCwIcon />
                    {props.restarting || props.session.runtimeControl?.restart.status === 'restarting'
                      ? t('layout.session.restarting', 'Restarting…')
                      : t('layout.session.restart', 'Restart session')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <PencilIcon />
                  {t('layout.session.rename', 'Rename')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!!props.session.execution}
                  onClick={() => props.onOpenPropertiesPanel(props.session)}
                >
                  <PanelRightOpenIcon />
                  {t('layout.session.propertiesPanel', 'Properties Panel')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2Icon />
                  {t('layout.session.delete', 'Delete')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <RenameSessionDialog
        session={props.session}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRename={props.onRename}
      />
      <DeleteSessionDialog
        session={props.session}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDelete={props.onDelete}
      />
    </>
  );
}

interface DeleteSessionDialogProps {
  session: SessionDto;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDelete(session: SessionDto, options?: DeleteSessionOptionsDto): Promise<void>;
}

/**
 * Renders a confirmation dialog before permanently deleting a Session.
 */
function DeleteSessionDialog({ session, open, onOpenChange, onDelete }: DeleteSessionDialogProps) {
  const { t } = useI18n();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await onDelete(session, { deleteFiles });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('layout.session.deleteFailed', 'Failed to delete session.')
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('layout.session.deleteTitle', 'Delete session')}</DialogTitle>
          <DialogDescription>
            {t(
              'layout.session.deleteDescription',
              'Are you sure you want to delete "{{title}}"? This action cannot be undone.',
              { title: session.title }
            )}
          </DialogDescription>
        </DialogHeader>
        {
          <div className="flex items-center gap-2">
            <Checkbox
              id={`delete-files-${session.id}`}
              checked={deleteFiles}
              disabled={!!session.execution}
              onCheckedChange={(checked) => setDeleteFiles(Boolean(checked))}
            />
            <Label htmlFor={`delete-files-${session.id}`} className="font-normal">
              {t('layout.session.deleteFilesLabel', 'Also delete the underlying session file (JSONL)')}
            </Label>
          </div>
        }
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting && <Spinner />}
            {isDeleting ? t('layout.session.deleting', 'Deleting…') : t('layout.session.delete', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
