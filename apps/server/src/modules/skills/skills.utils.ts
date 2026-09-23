/**
 * @author Codex
 * @description Validation, error translation, SKILL.md composition, and path-safety helpers for the Skills Module.
 */
import { resolve, sep } from 'node:path';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { stringify } from 'yaml';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { ManagedSkillsStoreError } from '../../infrastructure/pi-skills/managed-skills-store.js';
import { unzipSync } from 'fflate';

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

export interface PreparedSkillUpload {
  name: string;
  files: Map<string, Buffer>;
}

/**
 * Converts one uploaded payload into a directory-shaped Skill bundle.
 *
 * @param filename Original browser filename used to detect the payload kind.
 * @param bytes Decoded upload payload bytes.
 * @returns Skill name and files keyed by Skill-relative POSIX paths.
 * @throws ApplicationError when the payload kind, size, or structure is unacceptable.
 */
export function prepareUploadedSkill(filename: string, bytes: Buffer): PreparedSkillUpload {
  if (bytes.length === 0 || bytes.length > MAX_SKILL_UPLOAD_BYTES) {
    throw new ApplicationError(
      'SKILL_UPLOAD_TOO_LARGE',
      `Skill upload must contain data and must not exceed ${String(MAX_SKILL_UPLOAD_BYTES)} bytes.`,
      { statusCode: 413 }
    );
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith('.md')) {
    return prepareMarkdownSkill(filename, bytes);
  }
  if (lower.endsWith('.zip')) {
    return prepareArchiveSkill(filename, bytes);
  }
  throw new ApplicationError(
    'SKILL_UPLOAD_TYPE_UNSUPPORTED',
    'Only .md and .zip Skill uploads are supported.',
    { statusCode: 415 }
  );
}

/**
 * Wraps one Markdown file as a directory Skill named by its frontmatter or file stem.
 *
 * @param filename Original Markdown filename.
 * @param bytes Raw Markdown payload bytes.
 * @returns Prepared bundle containing only SKILL.md.
 */
function prepareMarkdownSkill(filename: string, bytes: Buffer): PreparedSkillUpload {
  const content = bytes.toString('utf8');
  if (content.includes('\0')) {
    throw new ApplicationError('SKILL_UPLOAD_INVALID', 'Skill Markdown must be a UTF-8 text file.', {
      statusCode: 400,
    });
  }
  const stem = filename.replace(/\.md$/i, '');
  const name = deriveSkillName(content, stem);
  assertSkillFrontmatter(content);
  return { name, files: new Map([['SKILL.md', bytes]]) };
}

/**
 * Extracts a bounded zip archive and normalizes it to a flat Skill-relative file map.
 *
 * @param filename Original archive filename used as the Skill name fallback.
 * @param bytes Raw zip payload bytes.
 * @returns Prepared bundle with every archive entry under the Skill directory.
 */
function prepareArchiveSkill(filename: string, bytes: Buffer): PreparedSkillUpload {
  const entries = inflateArchive(bytes);
  const stripped = new Map<string, Buffer>();
  for (const [rawName, data] of Object.entries(entries)) {
    const relative = sanitizeArchiveEntryName(rawName);
    if (relative === null || isArchiveMetadata(relative)) {
      continue;
    }
    stripped.set(relative, Buffer.from(data));
  }
  const prefix = resolveArchivePrefix(stripped);
  const files = new Map<string, Buffer>();
  for (const [relative, data] of stripped) {
    const flattened = prefix === '' ? relative : relative.slice(prefix.length);
    if (flattened.length > 0) {
      files.set(flattened, data);
    }
  }
  const skillMarkdown = files.get('SKILL.md');
  if (skillMarkdown === undefined) {
    throw new ApplicationError('SKILL_ARCHIVE_INVALID', 'Skill archive must contain a SKILL.md file.', {
      statusCode: 400,
    });
  }
  const content = skillMarkdown.toString('utf8');
  const fallback = prefix === '' ? filename.replace(/\.zip$/i, '') : prefix.slice(0, -1);
  const name = deriveSkillName(content, fallback);
  assertSkillFrontmatter(content);
  return { name, files };
}

/**
 * Inflates a zip archive while enforcing count and size budgets before any entry expands.
 *
 * @param bytes Raw zip payload bytes.
 * @returns Archive entries keyed by their raw names.
 */
function inflateArchive(bytes: Buffer): Record<string, Uint8Array> {
  let fileCount = 0;
  let totalBytes = 0;
  try {
    return unzipSync(new Uint8Array(bytes), {
      filter: (file) => {
        fileCount += 1;
        if (fileCount > MAX_SKILL_ARCHIVE_FILES) {
          throw new ApplicationError(
            'SKILL_ARCHIVE_TOO_LARGE',
            `Skill archive must not contain more than ${String(MAX_SKILL_ARCHIVE_FILES)} files.`,
            { statusCode: 413 }
          );
        }
        if (file.originalSize > MAX_SKILL_ARCHIVE_FILE_BYTES) {
          throw new ApplicationError(
            'SKILL_ARCHIVE_TOO_LARGE',
            `Skill archive entry exceeds ${String(MAX_SKILL_ARCHIVE_FILE_BYTES)} bytes: ${file.name}`,
            { statusCode: 413 }
          );
        }
        totalBytes += file.originalSize;
        if (totalBytes > MAX_SKILL_ARCHIVE_TOTAL_BYTES) {
          throw new ApplicationError(
            'SKILL_ARCHIVE_TOO_LARGE',
            `Skill archive must not expand beyond ${String(MAX_SKILL_ARCHIVE_TOTAL_BYTES)} bytes.`,
            { statusCode: 413 }
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    throw new ApplicationError('SKILL_ARCHIVE_INVALID', 'Skill upload is not a readable zip archive.', {
      statusCode: 400,
      cause: error,
    });
  }
}

/**
 * Reports whether an archive entry is operating-system metadata that never belongs to a Skill.
 *
 * @param relative Sanitized archive entry path.
 */
function isArchiveMetadata(relative: string): boolean {
  return relative === '.DS_Store' || relative.startsWith('__MACOSX/') || relative.endsWith('/.DS_Store');
}

/**
 * Determines whether archive entries sit at the root or inside one shared top-level directory.
 *
 * @param files Sanitized archive entries keyed by relative path.
 * @returns Empty string for root-level SKILL.md, otherwise the top-level directory prefix.
 */
function resolveArchivePrefix(files: Map<string, Buffer>): string {
  if (files.has('SKILL.md')) {
    return '';
  }
  const topLevels = new Set([...files.keys()].map((relative) => relative.split('/')[0]));
  if (topLevels.size === 1) {
    const [top] = topLevels;
    if (files.has(`${top}/SKILL.md`)) {
      return `${top}/`;
    }
  }
  throw new ApplicationError(
    'SKILL_ARCHIVE_INVALID',
    'Skill archive must place SKILL.md at its root or inside a single top-level directory.',
    { statusCode: 400 }
  );
}

/**
 * Resolves the Skill identity from frontmatter, falling back to a filesystem-derived name.
 *
 * @param content Raw SKILL.md content.
 * @param fallback Name used when the frontmatter omits one.
 * @returns Validated Skill name.
 */
function deriveSkillName(content: string, fallback: string): string {
  const { frontmatter } = readUploadedFrontmatter(content);
  const declared = frontmatter['name'];
  const name = typeof declared === 'string' && declared.trim().length > 0 ? declared.trim() : fallback;
  assertValidSkillName(name);
  return name;
}

/**
 * Enforces the Pi Skill loader's hard requirement of a usable description.
 *
 * @param content Raw SKILL.md content.
 */
function assertSkillFrontmatter(content: string): void {
  const { frontmatter } = readUploadedFrontmatter(content);
  const description = frontmatter['description'];
  assertValidSkillDescription(typeof description === 'string' ? description : '');
}
