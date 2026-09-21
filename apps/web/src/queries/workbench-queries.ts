/**
 * @author Codex
 * @description Exposes Workspace and Session catalog operations through TanStack Query.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSession, deleteSession, getSessions, renameSession, setSessionPinned } from '../api/sessions';
import {
  createWorkspace,
  getWorkspaceFileContent,
  getWorkspaces,
  updateWorkspaceFileContent,
} from '../api/workspace';
import { queryKeys } from './query-keys';
import type { DeleteSessionOptionsDto, SessionDto } from '@octopus/shared/protocol';

/**
 * Reads the shared Workspace catalog.
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => getWorkspaces(signal),
  });
}

/**
 * Creates a Workspace and refreshes the shared Workspace catalog.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; slug?: string }) => createWorkspace(input),
    async onSuccess() {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

/**
 * Reads a Workspace Session catalog only after a Workspace is selected.
 */
export function useSessions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sessions(workspaceId),
    queryFn: ({ signal }) => getSessions(workspaceId ?? '', signal),
    enabled: workspaceId !== undefined,
  });
}

/**
 * Creates a Session and refreshes its Workspace catalog before navigation.
 */
export function useCreateSession(workspaceId: string | undefined, onCreated: (session: SessionDto) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!workspaceId) {
        throw new Error('Select a workspace first.');
      }
      return createSession(workspaceId);
    },
    async onSuccess(session) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(session.workspaceId) });
      onCreated(session);
    },
  });
}

/**
 * Renames one Session and updates the matching cached catalog row and snapshot.
 */
export function useRenameSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ session, title }: { session: SessionDto; title: string }) => renameSession(session, title),
    async onSuccess(updated) {
      queryClient.setQueryData<SessionDto[]>(queryKeys.sessions(updated.workspaceId), (current) =>
        current?.map((session) => (session.id === updated.id ? updated : session))
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.snapshot(updated.workspaceId, updated.id),
      });
    },
  });
}

/**
 * Changes one Session's pin state and refreshes the ordered Workspace catalog.
 */
export function useSetSessionPinned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ session, pinned }: { session: SessionDto; pinned: boolean }) =>
      setSessionPinned(session, pinned),
    async onSuccess(updated) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(updated.workspaceId) });
    },
  });
}

/**
 * Deletes one Session and removes it from the cached Workspace catalog.
 */
export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ session, options }: { session: SessionDto; options?: DeleteSessionOptionsDto }) => {
      await deleteSession(session, options);
    },
    async onSuccess(_, { session }) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions(session.workspaceId) });
    },
  });
}

/**
 * Reads one Workspace text file while its editor is mounted.
 */
export function useWorkspaceFileContent(workspaceId: string, path: string) {
  return useQuery({
    queryKey: queryKeys.workspaceFile(workspaceId, path),
    queryFn: ({ signal }) => getWorkspaceFileContent(workspaceId, path, signal),
  });
}

/**
 * Saves a Workspace text file and synchronizes its cached editor content.
 */
export function useUpdateWorkspaceFileContent(workspaceId: string, path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => updateWorkspaceFileContent(workspaceId, path, content),
    onSuccess(_, content) {
      queryClient.setQueryData(queryKeys.workspaceFile(workspaceId, path), content);
    },
  });
}
