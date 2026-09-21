/**
 * @author Codex
 * @description Defines scope-aware HTTP operations for Global and Workspace Skill management.
 */

import { readAsDataUrl } from '../utils/common';
import { request } from '../utils/request';
import type { EffectiveSkillCatalogDto, SkillCatalogDto, SkillDetailDto } from '@octopus/shared/protocol';

export type SkillScope = { kind: 'global' } | { kind: 'workspace'; workspaceId: string };

export interface SkillEditorInput {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  body: string;
}

export type SkillUpdateInput = Omit<SkillEditorInput, 'name'>;

/**
 * Resolves the route prefix expressing one Skill scope.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 */
function skillsBasePath(scope: SkillScope): string {
  return scope.kind === 'global' ? '/skills' : `/workspaces/${encodeURIComponent(scope.workspaceId)}/skills`;
}

/**
 * Retrieves the Skill catalog of one scope, including its backing directory.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 * @param signal Optional cancellation signal supplied by the query layer.
 */
export function getSkills(scope: SkillScope, signal?: AbortSignal): Promise<SkillCatalogDto> {
  return request<SkillCatalogDto>({
    url: skillsBasePath(scope),
    method: 'GET',
    signal,
  });
}

/**
 * Retrieves every Skill Pi resolves for one Workspace, optionally from an exact live Runtime snapshot.
 *
 * @param workspaceId Workspace whose resource context should be resolved.
 * @param runtimeId Optional live Runtime identity for exact session consistency.
 * @param signal Optional cancellation signal supplied by the query layer.
 */
export function getEffectiveSkills(
  workspaceId: string,
  runtimeId: string | undefined,
  signal?: AbortSignal
): Promise<EffectiveSkillCatalogDto> {
  return request<EffectiveSkillCatalogDto>({
    url: `/workspaces/${encodeURIComponent(workspaceId)}/effective-skills`,
    method: 'GET',
    params: runtimeId === undefined ? undefined : { runtimeId },
    signal,
  });
}

/**
 * Retrieves one Skill's editing payload.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 * @param name Skill identity shown in the catalog.
 * @param signal Optional cancellation signal supplied by the query layer.
 */
export function getSkill(scope: SkillScope, name: string, signal?: AbortSignal): Promise<SkillDetailDto> {
  return request<{ skill: SkillDetailDto }>({
    url: `${skillsBasePath(scope)}/${encodeURIComponent(name)}`,
    method: 'GET',
    signal,
  }).then((response) => response.skill);
}

/**
 * Creates a Skill from structured editor fields.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 * @param input Validated Skill definition collected by the editor dialog.
 */
export function createSkill(scope: SkillScope, input: SkillEditorInput): Promise<SkillDetailDto> {
  return request<{ skill: SkillDetailDto }>({
    url: skillsBasePath(scope),
    method: 'POST',
    data: input,
  }).then((response) => response.skill);
}

/**
 * Replaces the editable fields of one Skill.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 * @param name Skill identity to update.
 * @param input Replacement editor fields.
 */
export function updateSkill(
  scope: SkillScope,
  name: string,
  input: SkillUpdateInput
): Promise<SkillDetailDto> {
  return request<{ skill: SkillDetailDto }>({
    url: `${skillsBasePath(scope)}/${encodeURIComponent(name)}`,
    method: 'PUT',
    data: input,
  }).then((response) => response.skill);
}

/**
 * Deletes one Skill and all of its resource files.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 * @param name Skill identity to remove.
 */
export function deleteSkill(scope: SkillScope, name: string): Promise<void> {
  return request<{ deleted: string }>({
    url: `${skillsBasePath(scope)}/${encodeURIComponent(name)}`,
    method: 'DELETE',
  }).then(() => undefined);
}

/**
 * Uploads a browser File (.md or .zip) as one Skill.
 *
 * @param scope Global catalog or one Workspace's project Skills.
 * @param file File selected by the user.
 * @param overwrite Whether an existing Skill with the same name may be replaced.
 */
export async function uploadSkill(
  scope: SkillScope,
  file: File,
  overwrite: boolean
): Promise<SkillDetailDto> {
  const dataUrl = await readAsDataUrl(file);
  return request<{ skill: SkillDetailDto }>({
    url: `${skillsBasePath(scope)}/upload`,
    method: 'POST',
    data: {
      filename: file.name,
      data: dataUrl.split(',', 2)[1] ?? '',
      overwrite,
    },
  }).then((response) => response.skill);
}
