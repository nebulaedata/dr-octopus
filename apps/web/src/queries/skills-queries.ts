/**
 * @author Codex
 * @description Exposes scope-aware Skill management operations through TanStack Query.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSkill,
  deleteSkill,
  getEffectiveSkills,
  getSkill,
  getSkills,
  updateSkill,
  uploadSkill,
} from '../api/skills';
import { queryKeys } from './query-keys';
import type { SkillEditorInput, SkillScope, SkillUpdateInput } from '../api/skills';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Reads the Skill catalog of one scope.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 */
export function useSkills(scope: SkillScope) {
  return useQuery({
    queryKey: queryKeys.skills(scope),
    queryFn: ({ signal }) => getSkills(scope, signal),
  });
}

/**
 * Reads the effective Pi Skill catalog for one Workspace or exact live Runtime.
 *
 * @param workspaceId Workspace whose resource context should be resolved.
 * @param runtimeId Optional Runtime identity for exact session consistency.
 */
export function useEffectiveSkills(workspaceId: string, runtimeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.effectiveSkills(workspaceId, runtimeId),
    queryFn: ({ signal }) => getEffectiveSkills(workspaceId, runtimeId, signal),
    enabled: workspaceId.length > 0,
  });
}

/**
 * Refreshes every effective catalog because a Global mutation may affect every Workspace.
 */
async function invalidateEffectiveSkills(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.effectiveSkillsRoot }),
    queryClient.invalidateQueries({ queryKey: queryKeys.bootstrapRoot }),
  ]);
}

/**
 * Reads one Skill's editing payload while its dialog is mounted.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 * @param name Skill identity to load.
 * @param enabled Whether the detail view is currently visible.
 */
export function useSkill(scope: SkillScope, name: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.skill(scope, name),
    queryFn: ({ signal }) => getSkill(scope, name, signal),
    enabled,
  });
}

/**
 * Creates a Skill in one scope and refreshes that scope's catalog.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 */
export function useCreateSkill(scope: SkillScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillEditorInput) => createSkill(scope, input),
    async onSuccess(skill) {
      queryClient.setQueryData(queryKeys.skill(scope, skill.name), skill);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.skills(scope) }),
        invalidateEffectiveSkills(queryClient),
      ]);
    },
  });
}

/**
 * Updates one Skill and synchronizes its cached catalog row and detail payload.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 */
export function useUpdateSkill(scope: SkillScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, input }: { name: string; input: SkillUpdateInput }) =>
      updateSkill(scope, name, input),
    async onSuccess(skill) {
      queryClient.setQueryData(queryKeys.skill(scope, skill.name), skill);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.skills(scope) }),
        invalidateEffectiveSkills(queryClient),
      ]);
    },
  });
}

/**
 * Uploads a Skill file into one scope and refreshes that scope's catalog.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 */
export function useUploadSkill(scope: SkillScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, overwrite }: { file: File; overwrite: boolean }) =>
      uploadSkill(scope, file, overwrite),
    async onSuccess(skill) {
      queryClient.setQueryData(queryKeys.skill(scope, skill.name), skill);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.skills(scope) }),
        invalidateEffectiveSkills(queryClient),
      ]);
    },
  });
}

/**
 * Deletes one Skill and drops it from the cached catalog and detail cache.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 */
export function useDeleteSkill(scope: SkillScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteSkill(scope, name),
    async onSuccess(_, name) {
      queryClient.removeQueries({ queryKey: queryKeys.skill(scope, name) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.skills(scope) }),
        invalidateEffectiveSkills(queryClient),
      ]);
    },
  });
}
