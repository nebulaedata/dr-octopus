/**
 * @author Codex
 * @description Owns the Workbench-only realtime lifecycle, resizable sidebars, Header, and route content frame.
 */

import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router';
import { SidebarProvider, useSidebar } from '@octopus/ui/components/sidebar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@octopus/ui/components/resizable';
import { cn } from '@octopus/ui/lib/utils';
import { useIsXl } from '@/hooks/use-breakpoint';
import {
  useCreateWorkspace,
  useDeleteSession,
  useRenameSession,
  useSetSessionPinned,
  useSessions,
  useWorkspaces,
} from '@/queries/workbench-queries';
import { useDataEventsLifecycle } from '@/queries/data-events-lifecycle';
import { useRealtimeLifecycle } from '@/queries/realtime-queries';
import { useWorkbenchHome } from '@/stores/workbench-home';
import { ShortcutKeyRegister, useShortcut } from '@/lib/shortcuts';
import { Header } from './Header';
import { getSiblingSession } from './session-navigation';
import { Sidebar } from './Sidebar';
import { ConnectionStatus } from './ConnectionStatus';
import { SessionPropertiesPanel } from './SessionPropertiesPanel';
import { FileExplorerPanel } from '@/features/session/FileExplorerPanel';
import type { PanelImperativeHandle } from '@octopus/ui/components/resizable';
import type { DeleteSessionOptionsDto, SessionDto } from '@octopus/shared/protocol';

const LazySettingsDialogHost = lazy(() =>
  import('@/features/settings').then((module) => ({ default: module.SettingsDialogHost }))
);

/**
 * Keeps Workbench resources mounted while route-specific content changes inside main.
 */
export function Layout() {
  return (
    <>
      <ConnectionStatus />
      <SidebarProvider defaultOpen className="h-dvh">
        <WorkbenchLayout />
      </SidebarProvider>
    </>
  );
}

const SIDEBAR_MIN_WIDTH = 192;
const SIDEBAR_MAX_WIDTH = 384;
const SIDEBAR_DEFAULT_WIDTH = 265;
const RIGHT_PANEL_MIN_WIDTH = 200;
const RIGHT_PANEL_MAX_WIDTH = 450;
const RIGHT_PANEL_DEFAULT_WIDTH = 300;

/**
 * Wires the resizable left sidebar with the shadcn sidebar state context.
 */
function WorkbenchLayout() {
  useRealtimeLifecycle();
  useDataEventsLifecycle();
  const params = useParams({ strict: false }) as { workspaceId?: string; sessionId?: string };
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const sideright = search.sideright;
  const workspaces = useWorkspaces();
  const selectedWorkspaceId =
    params.workspaceId ?? workspaces.data?.find((workspace) => workspace.kind === 'general')?.id;
  const sessions = useSessions(selectedWorkspaceId);
  const renameSession = useRenameSession();
  const setSessionPinned = useSetSessionPinned();
  const deleteSession = useDeleteSession();
  const createWorkspace = useCreateWorkspace();
  const activeSession = sessions.data?.find(
    (session) => session.id === params.sessionId && session.workspaceId === selectedWorkspaceId
  );
  const error = getErrorMessage(sessions.error ?? workspaces.error ?? deleteSession.error);

  const { isMobile, open, openMobile, setOpen, toggleSidebar } = useSidebar();
  const isXl = useIsXl();
  // Each right-side panel declares its own visibility condition instead of sharing one gate.
  const canShowFileExplorer = sideright === 'file-explorer' && isXl && selectedWorkspaceId !== undefined;
  const canShowProperties = sideright === 'properties-panel' && isXl && activeSession !== undefined;
  const canShowRightPanel = canShowFileExplorer || canShowProperties;
  const [initialRightOpen] = useState(() => canShowRightPanel);
  const leftPanelRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);
  const hasRightPanelExpanded = useRef(false);

  useEffect(() => {
    if (open) {
      leftPanelRef.current?.expand();
    } else {
      leftPanelRef.current?.collapse();
    }
  }, [open]);

  useLayoutEffect(() => {
    if (canShowRightPanel) {
      if (!hasRightPanelExpanded.current) {
        rightPanelRef.current?.resize(RIGHT_PANEL_DEFAULT_WIDTH);
        hasRightPanelExpanded.current = true;
      } else {
        rightPanelRef.current?.expand();
      }
    } else {
      rightPanelRef.current?.collapse();
    }
  }, [canShowRightPanel]);

  /**
   * Closes the right panel while preserving the current route and other search parameters.
   */
  const closeRightPanel = () => {
    void navigate({ to: '.', search: (prev) => ({ ...prev, sideright: undefined }) });
  };

  /**
   * Toggles the requested panel using the latest URL state, preserving other search parameters.
   */
  const toggleRightPanel = (panel: NonNullable<typeof sideright>) => {
    void navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        sideright: prev.sideright === panel ? undefined : panel,
      }),
    });
  };

  /**
   * Cycles through Sidebar Sessions, entering from either end when no Session is selected.
   */
  const navigateSiblingSession = (direction: -1 | 1): boolean => {
    const target = getSiblingSession(sessions.data ?? [], params.sessionId, direction);
    if (target === undefined) {
      return false;
    }
    void navigate({
      to: '/workspaces/$workspaceId/sessions/$sessionId',
      params: { workspaceId: target.workspaceId, sessionId: target.id },
      search: (prev) => prev,
    });
    return true;
  };

  useShortcut(ShortcutKeyRegister.TOGGLE_LEFT_SIDEBAR, () => {
    toggleSidebar();
    return true;
  });
  useShortcut(ShortcutKeyRegister.TOGGLE_RIGHT_PANEL, () => {
    if (!isXl || selectedWorkspaceId === undefined) {
      return false;
    }
    toggleRightPanel('file-explorer');
    return true;
  });
  useShortcut(ShortcutKeyRegister.NEW_SESSION, () => {
    if (selectedWorkspaceId === undefined) {
      return false;
    }
    useWorkbenchHome.getState().ensureDraftId(selectedWorkspaceId);
    void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: selectedWorkspaceId } });
    return true;
  });
  useShortcut(ShortcutKeyRegister.PREVIOUS_SESSION, () => navigateSiblingSession(-1));
  useShortcut(ShortcutKeyRegister.NEXT_SESSION, () => navigateSiblingSession(1));

  const handleDeleteSession = async (session: SessionDto, options?: DeleteSessionOptionsDto) => {
    await deleteSession.mutateAsync({ session, options });
    if (session.id === params.sessionId) {
      void navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId: session.workspaceId },
        search: (prev) => prev,
      });
    }
  };

  const sidebarContent = (
    <Sidebar
      workspaces={workspaces.data ?? []}
      sessions={sessions.data ?? []}
      selectedWorkspaceId={selectedWorkspaceId}
      selectedSessionId={params.sessionId}
      loading={workspaces.isLoading || sessions.isLoading}
      creating={selectedWorkspaceId === undefined}
      error={error}
      onCreate={() => {
        if (selectedWorkspaceId === undefined) {
          return;
        }
        useWorkbenchHome.getState().ensureDraftId(selectedWorkspaceId);
        void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: selectedWorkspaceId } });
      }}
      onSelectWorkspace={(workspaceId) => {
        setTimeout(() => {
          void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId } });
        }, 100);
      }}
      onCreateWorkspace={async (input) => {
        const workspace = await createWorkspace.mutateAsync(input);
        void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: workspace.id } });
        return workspace;
      }}
      onSelectSession={(session) =>
        void navigate({
          to: '/workspaces/$workspaceId/sessions/$sessionId',
          params: { workspaceId: session.workspaceId, sessionId: session.id },
          search: (prev) => prev,
        })
      }
      onRenameSession={async (session, title) => {
        await renameSession.mutateAsync({ session, title });
      }}
      onSetSessionPinned={async (session, pinned) => {
        await setSessionPinned.mutateAsync({ session, pinned });
      }}
      onDeleteSession={handleDeleteSession}
      onOpenPropertiesPanel={(session) =>
        void navigate({
          to: '/workspaces/$workspaceId/sessions/$sessionId',
          params: { workspaceId: session.workspaceId, sessionId: session.id },
          search: (prev) => ({ ...prev, sideright: 'properties-panel' }),
        })
      }
      showPropertiesPanel={sideright === 'properties-panel'}
      onTogglePropertiesPanel={() => toggleRightPanel('properties-panel')}
      onToggleSidebar={toggleSidebar}
      settingsActive={search.settings !== undefined || pathname.startsWith('/settings')}
      onOpenSettings={() => {
        if (search.settings !== undefined || pathname.startsWith('/settings')) {
          return;
        }
        void navigate({
          to: '.',
          search: (previous) => ({
            ...previous,
            settings: { path: '/settings/model-providers' },
          }),
          mask: {
            to: '/settings/model-providers',
            search: {},
            unmaskOnReload: true,
          },
        });
      }}
    />
  );

  const settingsDialog =
    search.settings === undefined ? null : (
      <Suspense fallback={null}>
        <LazySettingsDialogHost location={search.settings} />
      </Suspense>
    );

  const mainContent = (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <Header
        session={activeSession}
        workspaceId={selectedWorkspaceId}
        filesPanelOpen={sideright === 'file-explorer'}
        onToggleFilesPanel={() => toggleRightPanel('file-explorer')}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <Outlet />
      </div>
    </main>
  );

  if (isMobile) {
    return (
      <>
        <div className="relative flex h-full w-full overflow-hidden">
          {openMobile && (
            <>
              <button
                type="button"
                aria-label="Close sidebar"
                className="absolute inset-0 z-30 bg-black/35"
                onClick={toggleSidebar}
              />
              <aside className="absolute inset-y-0 left-0 z-40 w-[min(85vw,20rem)] shadow-xl">
                {sidebarContent}
              </aside>
            </>
          )}
          {mainContent}
        </div>
        {settingsDialog}
      </>
    );
  }

  return (
    <>
      <div className="flex h-full w-full">
        <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
          <ResizablePanel
            id="workbench-left-sidebar"
            className="min-w-0"
            panelRef={leftPanelRef}
            defaultSize={SIDEBAR_DEFAULT_WIDTH}
            minSize={SIDEBAR_MIN_WIDTH}
            maxSize={SIDEBAR_MAX_WIDTH}
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => {
              const collapsed = size.inPixels === 0;
              if (collapsed && open) {
                setOpen(false);
              } else if (!collapsed && !open) {
                setOpen(true);
              }
            }}
          >
            {sidebarContent}
          </ResizablePanel>
          <ResizableHandle withHandle className={cn(!open && 'hidden')} />
          <ResizablePanel id="workbench-main" className="min-w-0">
            {mainContent}
          </ResizablePanel>
          <ResizableHandle
            withHandle
            disabled={!canShowRightPanel}
            className={cn(!canShowRightPanel && 'invisible')}
          />
          <ResizablePanel
            id="workbench-right-sidebar"
            panelRef={rightPanelRef}
            defaultSize={initialRightOpen ? RIGHT_PANEL_DEFAULT_WIDTH : 0}
            minSize={RIGHT_PANEL_MIN_WIDTH}
            maxSize={RIGHT_PANEL_MAX_WIDTH}
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
            className="min-w-0"
          >
            {canShowProperties && (
              <SessionPropertiesPanel session={activeSession} onClose={closeRightPanel} />
            )}
            {canShowFileExplorer && (
              <FileExplorerPanel workspaceId={selectedWorkspaceId} onClose={closeRightPanel} />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      {settingsDialog}
    </>
  );
}

/**
 * Projects Query errors into one navigation-safe message.
 */
function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}
