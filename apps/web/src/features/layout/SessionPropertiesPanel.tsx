/**
 * @author GitHub Copilot
 * @description Adapts the session-scoped Properties panel for the shared Workbench layout chrome.
 */

import { useNavigate } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { useRealtimeConnection } from '@/hooks/use-realtime';
import { sessionStores } from '@/stores/session';
import { PropertiesPanel } from '@/features/session';
import type { SessionDto } from '@octopus/shared/protocol';

export interface SessionPropertiesPanelProps {
  session: SessionDto;
  onClose(): void;
}

/**
 * Renders the active Session's Properties panel without owning the Session route.
 */
export function SessionPropertiesPanel({ session, onClose }: SessionPropertiesPanelProps) {
  const navigate = useNavigate();
  const connection = useRealtimeConnection();
  const store = sessionStores.ensure(session.id);
  const runtimeId = useStore(store, (state) => state.runtimeId);
  const epoch = useStore(store, (state) => state.epoch);

  return (
    <PropertiesPanel
      visible
      session={session}
      connection={connection}
      runtimeId={runtimeId}
      epoch={epoch}
      onClose={onClose}
      onNavigate={(nextWorkspaceId, nextSessionId) =>
        void navigate({
          to: '/workspaces/$workspaceId/sessions/$sessionId',
          params: { workspaceId: nextWorkspaceId, sessionId: nextSessionId },
          search: (prev) => prev,
        })
      }
    />
  );
}
