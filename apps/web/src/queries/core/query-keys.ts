/**
 * @author Codex
 * @description Defines hierarchical TanStack Query cache keys for Web server state.
 */

import type { SkillScope } from '@/api/skills';

export const queryKeys = {
  settingsRoot: ['settings'] as const,
  modelProvidersRoot: ['settings', 'model-providers'] as const,
  modelProviders: ['settings', 'model-providers', 'catalog'] as const,
  modelProvider: (providerKey: string) => ['settings', 'model-providers', providerKey] as const,
  providerAuthSession: (providerKey: string, authSessionId: string) =>
    ['settings', 'model-providers', providerKey, 'auth-sessions', authSessionId] as const,
  defaultModel: ['settings', 'default-model'] as const,
  defaultModelCandidates: ['settings', 'default-model', 'candidates'] as const,
  imagegen: ['settings', 'imagegen'] as const,
  imagegenCandidates: ['settings', 'imagegen', 'candidates'] as const,
  mcpServersRoot: ['settings', 'mcp-servers'] as const,
  mcpServers: ['settings', 'mcp-servers', 'catalog'] as const,
  mcpServer: (serverKey: string) => ['settings', 'mcp-servers', serverKey] as const,
  workspaces: ['workspaces'] as const,
  sessions: (workspaceId: string | undefined) =>
    workspaceId === undefined ? (['sessions'] as const) : (['sessions', workspaceId] as const),
  sessionDraft: (workspaceId: string, draftId: string) => ['session-draft', workspaceId, draftId] as const,
  history: (workspaceId: string, sessionId: string) => ['session-history', workspaceId, sessionId] as const,
  snapshot: (workspaceId: string, sessionId: string) => ['snapshot', workspaceId, sessionId] as const,
  bootstrapRoot: ['bootstrap'] as const,
  bootstrap: (workspaceId: string, sessionId: string) =>
    [...queryKeys.bootstrapRoot, workspaceId, sessionId] as const,
  workspaceFile: (workspaceId: string, path: string) => ['workspace-file', workspaceId, path] as const,
  effectiveSkillsRoot: ['skills', 'effective'] as const,
  effectiveSkills: (workspaceId: string, runtimeId: string | undefined) =>
    [...queryKeys.effectiveSkillsRoot, workspaceId, runtimeId ?? 'resolved'] as const,
  skills: (scope: SkillScope) =>
    scope.kind === 'global'
      ? (['skills', 'global'] as const)
      : (['skills', 'workspace', scope.workspaceId] as const),
  skill: (scope: SkillScope, name: string) => [...queryKeys.skills(scope), name] as const,
};
