/**
 * @author Codex
 * @description Produces a two-file Skill archive from a verified browser copy, excluding session and credential data.
 */
import { zipSync, strToU8 } from 'fflate';
import { readSkillCache } from './skill-snapshot';

/**
 * Exports only the two fixed definition filenames, never user-controlled archive paths.
 */
export function skillArchive(raw: unknown): Uint8Array {
  const { snapshot } = readSkillCache(raw);
  return zipSync({
    'SKILL.md': strToU8(snapshot.candidate.skillMarkdown),
    'workflow.json': strToU8(JSON.stringify(snapshot.candidate.workflow, null, 2)),
  });
}
