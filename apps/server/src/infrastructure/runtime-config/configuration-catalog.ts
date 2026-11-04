/**
 * @author Codex
 * @description Defines configuration identities and their existing control DTO projections.
 */
export const configurationCatalog = {
  'model-providers': '/settings/model-providers',
  'mcp-servers': '/settings/mcp-servers',
  'agent-environment': '/settings/environment/agent',
  skills: '/skills',
} as const;
export type ConfigurationCategory = keyof typeof configurationCatalog;
export type ConfigurationScope = { kind: 'global' } | { kind: 'workspace'; workspaceId: string };
/**
 * Projects internal identities into the current public Session contract.
 */
export function configurationRoutes(categories: readonly ConfigurationCategory[]): string[] {
  return categories.map((category) => configurationCatalog[category]);
}
