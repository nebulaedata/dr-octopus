/**
 * @author Codex
 * @description Validation, error translation, SKILL.md composition, and path-safety helpers for the Skills Module.
 */

import { resolve, sep } from 'node:path';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { stringify } from 'yaml';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { ManagedSkillsStoreError } from '../../lib/pi-skills/managed-skills-store.js';

export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_BODY_BYTES = 1024 * 1024;
export const MAX_SKILL_UPLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_SKILL_ARCHIVE_FILES = 200;
export const MAX_SKILL_ARCHIVE_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_SKILL_ARCHIVE_FILE_BYTES = 8 * 1024 * 1024;

const SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Checks an unknown Node filesystem error for a stable error code.
 *
 * @param error Unknown thrown value.
 * @param code Expected Node error code.
 * @returns Whether the value exposes the expected code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/**
 * Executes one Pi Skills storage operation behind the Skills Module's public error contract.
 *
 * @param operation Deferred storage operation to execute.
 * @returns The storage operation result when successful.
 * @throws ApplicationError with a stable Skills Module code when storage access fails.
 */
export async function withManagedSkillsStoreErrors<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ManagedSkillsStoreError)) {
      throw new ApplicationError('SKILL_READ_FAILED', 'Unable to access the Skill definition.', {
        statusCode: 500,
        cause: error,
      });
    }
    if (error.reason === 'not-found') {
      throw new ApplicationError('SKILL_NOT_FOUND', error.message, {
        statusCode: 404,
        cause: error,
      });
    }
    if (error.reason === 'invalid-name') {
      throw new ApplicationError('SKILL_NAME_INVALID', error.message, {
        statusCode: 400,
        cause: error,
      });
    }
    throw new ApplicationError('SKILL_READ_FAILED', error.message, {
      statusCode: 500,
      cause: error,
    });
  }
}

/**
 * Enforces the Agent Skills naming contract shared with the Pi Skill loader.
 *
 * @param name User-supplied Skill identity; also the on-disk directory name.
 * @throws ApplicationError when the name violates the specification.
 */
export function assertValidSkillName(name: string): void {
  const problems: string[] = [];
  if (name.length === 0 || name.length > MAX_SKILL_NAME_LENGTH) {
    problems.push(`must be 1-${String(MAX_SKILL_NAME_LENGTH)} characters`);
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    problems.push('must contain only lowercase letters, digits, and hyphens');
  }
  if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
    problems.push('must use single hyphens between characters');
  }
  if (problems.length > 0) {
    throw new ApplicationError('SKILL_NAME_INVALID', `Skill name is invalid: ${problems.join('; ')}.`, {
      statusCode: 400,
    });
  }
}

/**
 * Enforces the Agent Skills description contract shared with the Pi Skill loader.
 *
 * @param description User-supplied Skill summary shown to the model.
 * @throws ApplicationError when the description is missing or oversized.
 */
export function assertValidSkillDescription(description: string): void {
  if (description.trim().length === 0) {
    throw new ApplicationError('SKILL_DESCRIPTION_INVALID', 'Skill description is required.', {
      statusCode: 400,
    });
  }
  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new ApplicationError(
      'SKILL_DESCRIPTION_INVALID',
      `Skill description must not exceed ${String(MAX_SKILL_DESCRIPTION_LENGTH)} characters.`,
      { statusCode: 400 }
    );
  }
}

/**
 * Enforces the bounded size accepted for one SKILL.md body write.
 *
 * @param body Markdown instructions persisted after the frontmatter block.
 * @throws ApplicationError when the body exceeds the edit limit.
 */
export function assertValidSkillBody(body: string): void {
  if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BODY_BYTES) {
    throw new ApplicationError(
      'SKILL_BODY_TOO_LARGE',
      `Skill instructions must not exceed ${String(MAX_SKILL_BODY_BYTES)} bytes.`,
      { statusCode: 413 }
    );
  }
}

export interface SkillMarkdownInput {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  body: string;
}

/**
 * Composes a specification-compliant SKILL.md from structured editor fields.
 *
 * @param input Validated Skill fields collected from the management UI.
 * @returns Complete SKILL.md content ready to persist.
 */
export function composeSkillMarkdown(input: SkillMarkdownInput): string {
  const frontmatter: Record<string, unknown> = {
    name: input.name,
    description: input.description,
  };
  if (input.disableModelInvocation) {
    frontmatter['disable-model-invocation'] = true;
  }
  return serializeSkillMarkdown(frontmatter, input.body);
}

/**
 * Merges editor fields into an existing SKILL.md while preserving unknown frontmatter keys.
 *
 * @param raw Current SKILL.md content read from disk.
 * @param patch Validated fields that replace their frontmatter counterparts.
 * @returns Complete SKILL.md content with untouched keys carried forward.
 */
export function mergeSkillMarkdown(
  raw: string,
  patch: { description: string; disableModelInvocation: boolean; body: string }
): string {
  const { frontmatter } = parseFrontmatter(raw);
  const merged: Record<string, unknown> = { ...frontmatter, description: patch.description };
  if (patch.disableModelInvocation) {
    merged['disable-model-invocation'] = true;
  } else {
    delete merged['disable-model-invocation'];
  }
  return serializeSkillMarkdown(merged, patch.body);
}

/**
 * Serializes frontmatter and body using the same YAML dialect as the Pi Skill loader.
 *
 * @param frontmatter Parsed frontmatter mapping to emit.
 * @param body Markdown instructions placed after the frontmatter block.
 * @returns Complete SKILL.md content.
 */
function serializeSkillMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const yamlBlock = stringify(frontmatter).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${body.trim()}\n`;
}

/**
 * Reads the frontmatter of one uploaded SKILL.md payload.
 *
 * @param content Raw SKILL.md content supplied by an upload.
 * @returns Parsed frontmatter mapping and Markdown body.
 */
export function readUploadedFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const parsed = parseFrontmatter(content);
  return { frontmatter: parsed.frontmatter, body: parsed.body };
}

/**
 * Resolves a validated Skill name under the Skills root and proves containment.
 *
 * @param root Trusted Skills root directory.
 * @param name Previously validated Skill name.
 * @returns Verified absolute path of the Skill directory.
 */
export function resolveSkillDir(root: string, name: string): string {
  const absolute = resolve(root, name);
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute === root || !absolute.startsWith(normalizedRoot)) {
    throw new ApplicationError('SKILL_NAME_INVALID', 'Skill name escapes the Skills directory.', {
      statusCode: 400,
    });
  }
  return absolute;
}

/**
 * Normalizes one archive entry name and rejects traversal outside the Skill directory.
 *
 * @param entryName Raw entry name reported by the zip archive.
 * @returns POSIX-style relative path, or null when the entry is a directory placeholder.
 * @throws ApplicationError when the entry targets a location outside the Skill directory.
 */
export function sanitizeArchiveEntryName(entryName: string): string | null {
  const segments = entryName.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  const firstSegment = segments[0] ?? '';
  if (segments.some((segment) => segment === '.' || segment === '..') || /^[a-zA-Z]:$/.test(firstSegment)) {
    throw new ApplicationError('SKILL_ARCHIVE_INVALID', 'Skill archive contains an unsafe entry path.', {
      statusCode: 400,
    });
  }
  if (entryName.endsWith('/') || entryName.endsWith('\\')) {
    return null;
  }
  return segments.join('/');
}
