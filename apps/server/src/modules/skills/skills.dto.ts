/**
 * @author Codex
 * @description Declares request payloads accepted by the Skills HTTP controller.
 */

export interface SkillRouteParams {
  name: string;
}

export interface WorkspaceSkillRouteParams {
  workspaceId: string;
  name: string;
}

export interface WorkspaceSkillsRouteParams {
  workspaceId: string;
}

export interface EffectiveSkillsQuery {
  runtimeId?: string;
}

export interface CreateSkillBody {
  name?: string;
  description?: string;
  disableModelInvocation?: boolean;
  body?: string;
}

export interface UpdateSkillBody {
  description?: string;
  disableModelInvocation?: boolean;
  body?: string;
}

export interface UploadSkillBody {
  filename?: string;
  data?: string;
  overwrite?: boolean;
}
