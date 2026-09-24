/**
 * @author Codex
 * @description Converts structured Composer mentions into the Workspace reference transport contract.
 */

import type { WorkspaceReferenceDto } from '@octopus/shared/protocol';
import type { ComposerReference } from '@/components/AgentComposerEditor/types';

/**
 * Converts atomic Lexical mentions into an ordered, duplicate-free transport payload.
 *
 * @param references Structured references extracted from the current editor state.
 * @returns Host-verifiable Workspace paths without presentation-only labels.
 */
export function toWorkspaceReferences(references: readonly ComposerReference[]): WorkspaceReferenceDto[] {
  const seen = new Set<string>();
  return references.flatMap(({ path, kind }) => {
    const key = `${kind}:${path}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ path, kind }];
  });
}
