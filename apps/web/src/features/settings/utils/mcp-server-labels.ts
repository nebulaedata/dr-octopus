/**
 * @author Codex
 * @description Centralizes user-facing labels for MCP protocol enum values.
 */

import type { Translate } from '@/i18n/use-i18n';
import type { McpServerSource } from '@octopus/shared/protocol';

/**
 * Resolves the localized display label for one MCP configuration source.
 *
 * @param t Project translation function supplied by the calling component.
 * @param source MCP configuration source enum value.
 * @returns Localized display label.
 */
export function getMcpServerSourceLabel(t: Translate, source: McpServerSource): string {
  const labels: Record<McpServerSource, string> = {
    shared_global: t('settings.mcp.source.sharedGlobal', 'Shared configuration'),
    agents_global: t('settings.mcp.source.agentsGlobal', 'Agents (global)'),
    agents_nested_global: t('settings.mcp.source.agentsNestedGlobal', 'Agents (nested global)'),
    pi_global: t('settings.mcp.source.piGlobal', 'Dr.Octopus'),
    host_import: t('settings.mcp.source.hostImport', 'Host import'),
    package_or_plugin: t('settings.mcp.source.packageOrPlugin', 'Extension package'),
  };
  return labels[source];
}
