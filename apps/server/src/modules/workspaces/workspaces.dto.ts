/**
 * @author Codex
 * @description Defines request data contracts accepted by Workspace HTTP endpoints.
 */

import type { WorkspaceFileEntryKind } from './workspaces.service.js';

export interface WorkspaceRouteParams {
  workspaceId: string;
}

export interface CreateWorkspaceBody {
  name: string;
  slug?: string;
}

export interface ListWorkspaceFilesQuery {
  path?: string;
}

export interface CreateWorkspaceEntryBody {
  path: string;
  type: WorkspaceFileEntryKind;
}

export interface DeleteWorkspaceEntriesBody {
  paths: string[];
}

export interface UploadWorkspaceFileBody {
  path: string;
  name: string;
  data: string;
}

export interface ReadWorkspaceFileQuery {
  path?: string;
}

export interface UpdateWorkspaceFileBody {
  path: string;
  content: string;
}

export interface DownloadWorkspaceEntryQuery {
  path?: string;
}
