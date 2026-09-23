/**
 * @author Codex
 * @description Manages one Server-owned Skill directory while reusing Pi's single-directory parser.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { loadSkillsFromDir, parseFrontmatter } from '@earendil-works/pi-coding-agent';

export type ManagedSkillsStoreErrorReason = 'invalid-name' | 'not-found' | 'read-failed';

export interface ResolvedPiSkill {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  warnings: string[];
  /** Absolute path of the Skill entrypoint (SKILL.md or a standalone Markdown file). */
  filePath: string;
  /** Absolute path of the Skill directory; equals the Skills root for standalone files. */
  baseDir: string;
  singleFile: boolean;
}

export interface PiSkillFile {
  path: string;
  sizeBytes: number;
}

export interface PiSkillInventory {
  fileCount: number;
  sizeBytes: number;
  updatedAt: string;
  files: PiSkillFile[];
}

/**
 * Describes a stable Pi Skills storage failure without coupling it to an application transport.
 */
export class ManagedSkillsStoreError extends Error {
  /**
   * @param reason Machine-readable failure category for the consuming application.
   * @param message Human-readable infrastructure failure description.
   * @param options Optional lower-level cause retained for diagnostics.
   */
  public constructor(
    public readonly reason: ManagedSkillsStoreErrorReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ManagedSkillsStoreError';
  }
}

/**
 * Reads and inventories only the Skills physically owned by one managed root.
 */
export class ManagedSkillsStore {
  /**
   * @param root Trusted Skills directory shared with the Pi runtime.
   */
  public constructor(public readonly root: string) {}

  /**
   * Discovers loadable Skills through Pi's parser without claiming a complete Runtime catalog.
   */
  public scan(): Map<string, ResolvedPiSkill> {
    return this.#runRead(() => {
      const { skills, diagnostics } = loadSkillsFromDir({ dir: this.root, source: 'user' });
      const warningsByPath = new Map<string, string[]>();
      for (const diagnostic of diagnostics) {
        if (diagnostic.path === undefined) {
          continue;
        }
        const warnings = warningsByPath.get(diagnostic.path) ?? [];
        warnings.push(diagnostic.message);
        warningsByPath.set(diagnostic.path, warnings);
      }
      const scanned = new Map<string, ResolvedPiSkill>();
      for (const skill of skills) {
        scanned.set(skill.name, {
          name: skill.name,
          description: skill.description,
          disableModelInvocation: skill.disableModelInvocation,
          warnings: warningsByPath.get(skill.filePath) ?? [],
          filePath: skill.filePath,
          baseDir: skill.baseDir,
          singleFile: basename(skill.filePath) !== 'SKILL.md',
        });
      }
      return scanned;
    }, 'Unable to scan the Skills directory.');
  }

  /**
   * Resolves one Skill by loader scan first, then by directory fallback for loader-rejected Skills.
   *
   * @param name Validated Skill directory identity.
   * @throws ManagedSkillsStoreError when the identity escapes the root or the Skill cannot be read.
   */
  public async resolve(name: string): Promise<ResolvedPiSkill> {
    const hit = this.scan().get(name);
    if (hit !== undefined) {
      return hit;
    }
    const dir = this.#resolveSkillDir(name);
    const filePath = join(dir, 'SKILL.md');
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) {
        throw new ManagedSkillsStoreError('not-found', `Skill was not found: ${name}`);
      }
    } catch (error) {
      if (error instanceof ManagedSkillsStoreError) {
        throw error;
      }
      if (hasErrorCode(error, 'ENOENT')) {
        throw new ManagedSkillsStoreError('not-found', `Skill was not found: ${name}`, { cause: error });
      }
      throw new ManagedSkillsStoreError('read-failed', 'Unable to inspect the Skill definition.', {
        cause: error,
      });
    }
    const raw = await this.#readFile(filePath, name);
    return this.#runRead(() => {
      const { frontmatter } = parseFrontmatter(raw);
      const { diagnostics } = loadSkillsFromDir({ dir, source: 'user' });
      return {
        name,
        description: typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '',
        disableModelInvocation: frontmatter['disable-model-invocation'] === true,
        warnings: diagnostics.map((diagnostic) => diagnostic.message),
        filePath,
        baseDir: dir,
        singleFile: false,
      };
    }, 'Unable to parse the Skill definition.');
  }

  /**
   * Reads one Skill entrypoint.
   *
   * @param skill Previously resolved Skill location.
   */
  public async readMarkdown(skill: ResolvedPiSkill): Promise<string> {
    return this.#readFile(skill.filePath, skill.name);
  }

  /**
   * Measures one Skill's file inventory without following symlinked directories.
   *
   * @param skill Previously resolved Skill location.
   * @throws ManagedSkillsStoreError when filesystem metadata cannot be read.
   */
  public async statSkill(skill: ResolvedPiSkill): Promise<PiSkillInventory> {
    try {
      if (skill.singleFile) {
        const stats = await stat(skill.filePath);
        return {
          fileCount: 1,
          sizeBytes: stats.size,
          updatedAt: stats.mtime.toISOString(),
          files: [{ path: basename(skill.filePath), sizeBytes: stats.size }],
        };
      }
      const files: PiSkillFile[] = [];
      let sizeBytes = 0;
      let updatedAt = 0;
      const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
        const dirents = await readdir(absoluteDir, { withFileTypes: true });
        for (const dirent of dirents) {
          if (dirent.isSymbolicLink()) {
            continue;
          }
          const absolute = join(absoluteDir, dirent.name);
          const relative = relativeDir === '' ? dirent.name : `${relativeDir}/${dirent.name}`;
          if (dirent.isDirectory()) {
            await walk(absolute, relative);
            continue;
          }
          if (!dirent.isFile()) {
            continue;
          }
          const stats = await stat(absolute);
          sizeBytes += stats.size;
          updatedAt = Math.max(updatedAt, stats.mtimeMs);
          files.push({ path: relative, sizeBytes: stats.size });
        }
      };
      await walk(skill.baseDir, '');
      files.sort((a, b) => {
        if (a.path < b.path) {
          return -1;
        }
        if (a.path > b.path) {
          return 1;
        }
        return 0;
      });
      return {
        fileCount: files.length,
        sizeBytes,
        updatedAt: new Date(updatedAt).toISOString(),
        files,
      };
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        throw new ManagedSkillsStoreError('not-found', `Skill was not found: ${skill.name}`, {
          cause: error,
        });
      }
      throw new ManagedSkillsStoreError('read-failed', 'Unable to inspect the Skill files.', {
        cause: error,
      });
    }
  }

  /**
   * Reads a Skill Markdown file and normalizes filesystem failures.
   *
   * @param filePath Absolute entrypoint path.
   * @param name Skill identity used in failure diagnostics.
   */
  async #readFile(filePath: string, name: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        throw new ManagedSkillsStoreError('not-found', `Skill was not found: ${name}`, { cause: error });
      }
      throw new ManagedSkillsStoreError('read-failed', 'Unable to read the Skill definition.', {
        cause: error,
      });
    }
  }

  /**
   * Resolves a Skill directory and enforces containment within the configured root.
   *
   * @param name Skill directory identity supplied by the consuming application.
   */
  #resolveSkillDir(name: string): string {
    const root = resolve(this.root);
    const absolute = resolve(root, name);
    const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
    if (absolute === root || !absolute.startsWith(rootWithSeparator)) {
      throw new ManagedSkillsStoreError('invalid-name', 'Skill name escapes the Skills directory.');
    }
    return absolute;
  }

  /**
   * Normalizes synchronous Pi loader and parser failures behind the store error contract.
   *
   * @param operation Read operation to execute.
   * @param message Stable failure description for the consuming application.
   */
  #runRead<T>(operation: () => T, message: string): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof ManagedSkillsStoreError) {
        throw error;
      }
      throw new ManagedSkillsStoreError('read-failed', message, { cause: error });
    }
  }
}

/**
 * Checks an unknown Node filesystem error for a stable error code.
 *
 * @param error Unknown thrown value.
 * @param code Expected Node error code.
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
