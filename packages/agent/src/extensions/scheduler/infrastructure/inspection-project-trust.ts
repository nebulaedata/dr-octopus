/**
 * @author Codex
 * @description Resolves disposable inspection trust before project resources load, using Pi's ordered trust handlers.
 */
import { hasTrustRequiringProjectResources, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import type { LoadExtensionsResult, SettingsManager } from '@earendil-works/pi-coding-agent';

/**
 * Honor the first explicit extension decision before persisted/default trust, as the Pi CLI does.
 * Inspection never prompts or persists a handler's remember request; handler failures stop inspection.
 */
export async function resolveInspectionProjectTrust(
  cwd: string,
  agentDir: string,
  settings: SettingsManager,
  loaded: LoadExtensionsResult
): Promise<boolean> {
  if (loaded.errors.length) {
    throw new Error('An extension failed before project trust could be resolved.');
  }
  if (!hasTrustRequiringProjectResources(cwd)) {
    return true;
  }
  const context = {
    cwd,
    mode: 'rpc' as const,
    hasUI: false,
    ui: {
      select: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(false),
      input: () => Promise.resolve(undefined),
      notify: () => {},
    },
  };
  for (const extension of loaded.extensions) {
    for (const handler of extension.handlers.get('project_trust') ?? []) {
      const result: unknown = await handler({ type: 'project_trust', cwd }, context);
      if (!result || typeof result !== 'object' || !('trusted' in result)) {
        throw new Error('Invalid project_trust result during authorization inspection.');
      }
      if (result.trusted === 'yes') {
        return true;
      }
      if (result.trusted === 'no') {
        return false;
      }
      if (result.trusted !== 'undecided') {
        throw new Error('Invalid project_trust decision during authorization inspection.');
      }
    }
  }
  return new ProjectTrustStore(agentDir).get(cwd) ?? settings.getDefaultProjectTrust() === 'always';
}
