/**
 * @author Claude Code
 * @description Normalizes uploaded Markdown files and zip archives into validated Skill bundles.
 */

import { unzipSync } from 'fflate';
import { ApplicationError } from '../../lib/errors/application-error.js';
import {
  MAX_SKILL_ARCHIVE_FILE_BYTES,
  MAX_SKILL_ARCHIVE_FILES,
  MAX_SKILL_ARCHIVE_TOTAL_BYTES,
  MAX_SKILL_UPLOAD_BYTES,
  assertValidSkillDescription,
  assertValidSkillName,
  readUploadedFrontmatter,
  sanitizeArchiveEntryName,
} from './skills.utils.js';

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
