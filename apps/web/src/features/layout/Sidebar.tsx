/**
 * @author Codex
 * @description Presents persistent Workspace selection and Session navigation inside the resizable left sidebar.
 */

import {
  FolderIcon,
  FolderPlusIcon,
  LoaderCircleIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  Settings2Icon,
  SettingsIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@octopus/ui/components/select';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { toast } from '@octopus/ui/components/toast';
import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { SessionListItem } from './SessionListItem';
import { useRestartSession } from '../session/use-restart-session';
import { RestartSessionDialog } from '../session/RestartSessionDialog';
import { useI18n } from '@/i18n/use-i18n';
import { workspaceDisplayName } from '@/utils/workspace';
import { MAX_PINNED_SESSIONS } from '@octopus/shared/protocol';
import type { DeleteSessionOptionsDto, SessionDto, WorkspaceDto } from '@octopus/shared/protocol';

export interface SidebarProps {
  workspaces: WorkspaceDto[];
  sessions: SessionDto[];
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  loading: boolean;
  creating: boolean;
  showPropertiesPanel?: boolean;
  error?: string;
  onCreate(): void;
  onSelectWorkspace(id: string): void;
  onCreateWorkspace(input: { name: string; slug?: string }): Promise<WorkspaceDto>;
  onSelectSession(session: SessionDto): void;
  onRenameSession(session: SessionDto, title: string): Promise<void>;
  onSetSessionPinned(session: SessionDto, pinned: boolean): Promise<void>;
  onDeleteSession(session: SessionDto, options?: DeleteSessionOptionsDto): Promise<void>;
  onOpenPropertiesPanel(session: SessionDto): void;
  onTogglePropertiesPanel(): void;
  onToggleSidebar(): void;
  settingsActive: boolean;
  onOpenSettings(): void;
}

/**
 * Renders common navigation using shadcn sidebar design tokens.
 */
export function Sidebar(props: SidebarProps) {
  const { t } = useI18n();
  const restart = useRestartSession();
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const pinnedSessionCount = props.sessions.reduce(
    (count, session) => count + (session.pinnedAt === undefined ? 0 : 1),
    0
  );

  /**
   * Enforces the visible pin limit before delegating the persisted mutation.
   */
  const handlePinnedChange = async (session: SessionDto, pinned: boolean): Promise<void> => {
    if (pinned && pinnedSessionCount >= MAX_PINNED_SESSIONS) {
      toast.add({
        title: t('layout.sidebar.pinLimitTitle', 'Pin up to {{max}} sessions', { max: MAX_PINNED_SESSIONS }),
        description: t('layout.sidebar.pinLimitDescription', 'Unpin a session first, then try again.'),
        type: 'warning',
      });
      return;
    }
    try {
      await props.onSetSessionPinned(session, pinned);
    } catch (error) {
      toast.add({
        title: t('layout.sidebar.pinFailedTitle', 'Failed to update pin'),
        description:
          error instanceof Error
            ? error.message
            : t('layout.sidebar.pinFailedDescription', 'Please try again later.'),
        type: 'error',
      });
    }
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      <div aria-label="header" className="flex min-h-17 items-center gap-2.5 px-3.5">
        <Logo size="sm" />
        <span className="flex-1 truncate text-lg font-semibold font-serif tracking-tight">
          {'Dr.Octopus'}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Collapse sidebar" onClick={props.onToggleSidebar}>
          <PanelLeftCloseIcon />
        </Button>
      </div>
      <div aria-label="main" className="flex-1 flex flex-col gap-2 overflow-hidden">
        <div className="flex flex-col gap-2 px-3.5">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>{t('layout.sidebar.workspace', 'Workspace')}</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button size="icon-sm" variant="ghost" onClick={() => setCreateWorkspaceOpen(true)}>
                    <FolderPlusIcon />
                  </Button>
                }
              />
              <TooltipContent side="right">
                {t('layout.sidebar.createWorkspaceTooltip', 'Create new workspace')}
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={props.selectedWorkspaceId ?? null}
            onValueChange={(value) => value !== null && props.onSelectWorkspace(value)}
          >
            <SelectTrigger className="w-full">
              <FolderIcon className="text-muted-foreground" />
              <SelectValue placeholder={t('layout.sidebar.workspace', 'Workspace')}>
                {(value: string | null) => {
                  const workspace = props.workspaces.find((candidate) => candidate.id === value);
                  if (workspace === undefined) {
                    return value;
                  }
                  return workspace.kind === 'general'
                    ? workspaceDisplayName(t, workspace)
                    : (workspace.slug ?? workspace.name);
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                {props.workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspaceDisplayName(t, workspace)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>{t('layout.sidebar.sessions', 'Sessions')}</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-pressed={props.showPropertiesPanel}
                    aria-label={props.showPropertiesPanel ? 'Hide properties panel' : 'Show properties panel'}
                    onClick={props.onTogglePropertiesPanel}
                  >
                    <Settings2Icon />
                  </Button>
                }
              />
              <TooltipContent side="right">
                {props.showPropertiesPanel
                  ? t('layout.sidebar.hideProperties', 'Hide properties panel')
                  : t('layout.sidebar.showProperties', 'Show properties panel')}
              </TooltipContent>
            </Tooltip>
          </div>
          <Button variant="outline" className="w-full" onClick={props.onCreate} disabled={props.creating}>
            {props.creating ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            {t('layout.sidebar.newSession', 'New session')}
          </Button>
          {props.error && (
            <Alert variant="destructive">
              <AlertTitle className="text-xs">
                {t('layout.sidebar.requestFailed', 'Request failed')}
              </AlertTitle>
              <AlertDescription className="text-[11px] break-all">{props.error}</AlertDescription>
            </Alert>
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1 px-3.5 pb-2">
          <div className="flex flex-col gap-2">
            {props.loading &&
              Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            {props.sessions.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                active={session.id === props.selectedSessionId}
                onSelect={props.onSelectSession}
                onRestart={restart.start}
                restarting={restart.pending.includes(session.id)}
                onRename={props.onRenameSession}
                onPinnedChange={handlePinnedChange}
                onDelete={props.onDeleteSession}
                onOpenPropertiesPanel={props.onOpenPropertiesPanel}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
      <div aria-label="footer" className="flex-none px-3.5 py-2 border-t">
        <Button
          variant="ghost"
          className="w-full"
          aria-pressed={props.settingsActive}
          onClick={props.onOpenSettings}
        >
          <SettingsIcon data-icon="inline-start" />
          <span className="flex-1 text-left text-sm font-medium">
            {t('layout.sidebar.settings', 'Settings')}
          </span>
        </Button>
      </div>
      <RestartSessionDialog action={restart} />
      <CreateWorkspaceDialog
        open={createWorkspaceOpen}
        onOpenChange={setCreateWorkspaceOpen}
        onCreate={props.onCreateWorkspace}
      />
    </div>
  );
}
