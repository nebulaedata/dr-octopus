/**
 * @author Codex
 * @description Orchestrates Global and Workspace scope Pi Skill lifecycle use cases over the filesystem read model.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { ApplicationError } from '../../lib/errors/application-error.js';
import { ManagedSkillsStore } from '../../lib/pi-skills/managed-skills-store.js';
import { prepareUploadedSkill } from './skills.upload.js';
import {
  assertValidSkillBody,
  assertValidSkillDescription,
  assertValidSkillName,
  composeSkillMarkdown,
  hasErrorCode,
  mergeSkillMarkdown,
  resolveSkillDir,
  withManagedSkillsStoreErrors,
} from './skills.utils.js';
import type { PiSkillInventory, ResolvedPiSkill } from '../../lib/pi-skills/managed-skills-store.js';
import type { SkillCatalogDto, SkillDetailDto, SkillDto } from '@octopus/shared/protocol';
import type { WorkspaceService } from '@octopus/agent';
import type { FastifyInstance } from 'fastify';

export type SkillScope = { kind: 'global' } | { kind: 'workspace'; workspaceId: string };

export interface SkillsServiceOptions {
  /** Overrides the Global Skills root; defaults to the Pi agent directory shared with the runtime. */
  skillsRoot?: string;
  /** Resolves Workspace identities to their working directories for Workspace-scope Skills. */
  workspaceService?: Pick<WorkspaceService, 'resolve'>;
}

export interface CreateSkillInput {
  name: string;
  description: string;
  disableModelInvocation?: boolean;
  body: string;
}

export interface UpdateSkillInput {
  description: string;
  disableModelInvocation?: boolean;
  body: string;
}

export interface UploadSkillInput {
  filename: string;
  data: string;
  overwrite?: boolean;
}

/**
 * Presents Global and Workspace scope Skill discovery, editing, upload, and removal through one cohesive Module.
 */
export class SkillsService {
  readonly #globalRoot: string;
  readonly #workspaceService?: Pick<WorkspaceService, 'resolve'>;

  /**
   * @param server Fastify instance exposing application plugins.
   * @param options Supplies the Global Skills root and the Workspace directory resolver.
   */
  public constructor(
    protected readonly server: FastifyInstance,
    options: SkillsServiceOptions = {}
  ) {
    this.#globalRoot = options.skillsRoot ?? join(getAgentDir(), 'skills');
    this.#workspaceService = options.workspaceService;
  }

  /**
   * Lists every loadable Skill in the requested scope with its backing directory.
   *
   * @param scope Global catalog or one Workspace's project Skills.
   */
  public async list(scope: SkillScope): Promise<SkillCatalogDto> {
    const store = await this.#resolveStore(scope);
    const rows: SkillDto[] = [];
    const skills = await withManagedSkillsStoreErrors(() => store.scan());
    for (const skill of skills.values()) {
      const inventory = await withManagedSkillsStoreErrors(() => store.statSkill(skill));
      rows.push(this.#toDto(skill, inventory));
    }
    return { root: store.root, skills: rows.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  /**
   * Reads one Skill's editing payload, including directory Skills the loader currently rejects.
   *
   * @param scope Global catalog or one Workspace's project Skills.
   * @param name Skill identity resolved against the loader scan and the Skills root.
   */
  public async get(scope: SkillScope, name: string): Promise<SkillDetailDto> {
    assertValidSkillName(name);
    const store = await this.#resolveStore(scope);
    const skill = await withManagedSkillsStoreErrors(() => store.resolve(name));
    return this.#toDetail(store, skill);
  }

  /**
   * Creates a directory Skill from structured editor fields.
   *
   * @param scope Global catalog or one Workspace's project Skills.
   * @param input Validated Skill fields collected from the management UI.
   * @throws When the Skill name is already taken.
   */
  public async create(scope: SkillScope, input: CreateSkillInput): Promise<SkillDetailDto> {
    const name = input.name.trim();
    const description = input.description.trim();
    assertValidSkillName(name);
    assertValidSkillDescription(description);
    assertValidSkillBody(input.body);
    const store = await this.#resolveStore(scope);
    if ((await withManagedSkillsStoreErrors(() => store.scan())).has(name)) {
      throw this.#alreadyExists(name);
    }
    const root = store.root;
    const dir = resolveSkillDir(root, name);
    await mkdir(root, { recursive: true });
    try {
      await mkdir(dir, { recursive: false });
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        throw this.#alreadyExists(name, error);
      }
      throw new ApplicationError('SKILL_CREATE_FAILED', 'Unable to create the Skill directory.', {
        statusCode: 500,
        cause: error,
      });
    }
    const markdown = composeSkillMarkdown({
      name,
      description,
      disableModelInvocation: input.disableModelInvocation === true,
      body: input.body,
    });
    try {
      await writeFile(join(dir, 'SKILL.md'), markdown, 'utf8');
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new ApplicationError('SKILL_CREATE_FAILED', 'Unable to write the Skill definition.', {
        statusCode: 500,
        cause: error,
      });
    }
    return this.get(scope, name);
  }

  /**
   * Replaces the editable fields of one Skill while preserving unknown frontmatter keys.
   *
   * @param scope Global catalog or one Workspace's project Skills.
   * @param name Skill identity to update.
   * @param input Replacement editor fields.
   */
  public async update(scope: SkillScope, name: string, input: UpdateSkillInput): Promise<SkillDetailDto> {
    const description = input.description.trim();
    assertValidSkillDescription(description);
    assertValidSkillBody(input.body);
    const store = await this.#resolveStore(scope);
    assertValidSkillName(name);
    const skill = await withManagedSkillsStoreErrors(() => store.resolve(name));
    const raw = await withManagedSkillsStoreErrors(() => store.readMarkdown(skill));
    const merged = mergeSkillMarkdown(raw, {
      description,
      disableModelInvocation: input.disableModelInvocation === true,
      body: input.body,
    });
    try {
      await writeFile(skill.filePath, merged, 'utf8');
    } catch (error) {
      throw new ApplicationError('SKILL_UPDATE_FAILED', 'Unable to save the Skill definition.', {
        statusCode: 500,
        cause: error,
      });
    }
    return this.get(scope, skill.name);
  }

  /**
   * Deletes one Skill directory or standalone Markdown file.
   *
   * @param scope Global catalog or one Workspace's project Skills.
   * @param name Skill identity to remove.
   */
  public async remove(scope: SkillScope, name: string): Promise<void> {
    const store = await this.#resolveStore(scope);
    assertValidSkillName(name);
    const skill = await withManagedSkillsStoreErrors(() => store.resolve(name));
    if (resolve(skill.filePath) === resolve(join(store.root, 'SKILL.md'))) {
      throw new ApplicationError(
        'SKILL_OPERATION_FORBIDDEN',
        'The Skills root definition cannot be deleted.',
        {
          statusCode: 400,
        }
      );
    }
    try {
      await rm(skill.singleFile ? skill.filePath : skill.baseDir, { recursive: true, force: false });
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        throw new ApplicationError('SKILL_NOT_FOUND', `Skill was not found: ${name}`, {
          statusCode: 404,
          cause: error,
        });
      }
      throw new ApplicationError('SKILL_DELETE_FAILED', 'Unable to delete the Skill.', {
        statusCode: 500,
        cause: error,
      });
    }
  }

  /**
   * Stores an uploaded Markdown file or zip archive as one validated directory Skill.
   *
   * @param scope Global catalog or one Workspace's project Skills.
   * @param input Original filename, Base64 payload, and overwrite consent.
   * @throws When a conflicting Skill exists without explicit overwrite consent.
   */
  public async upload(scope: SkillScope, input: UploadSkillInput): Promise<SkillDetailDto> {
    const filename = input.filename.trim();
    if (filename.length === 0) {
      throw new ApplicationError('SKILL_UPLOAD_INVALID', 'Skill upload requires a filename.', {
        statusCode: 400,
      });
    }
    const prepared = prepareUploadedSkill(filename, Buffer.from(input.data, 'base64'));
    const store = await this.#resolveStore(scope);
    if (input.overwrite !== true && (await this.#exists(store, prepared.name))) {
      throw this.#alreadyExists(prepared.name);
    }
    const root = store.root;
    await mkdir(root, { recursive: true });
    const staging = join(root, `.octopus-staging-${randomUUID()}`);
    try {
      await mkdir(staging, { recursive: false });
      for (const [relativePath, data] of prepared.files) {
        const target = resolve(staging, ...relativePath.split('/'));
        if (!target.startsWith(`${staging}${sep}`)) {
          throw new ApplicationError(
            'SKILL_ARCHIVE_INVALID',
            'Skill archive contains an unsafe entry path.',
            {
              statusCode: 400,
            }
          );
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data);
      }
      await rm(resolveSkillDir(root, prepared.name), { recursive: true, force: true });
      await rename(staging, resolveSkillDir(root, prepared.name));
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError('SKILL_UPLOAD_FAILED', 'Unable to store the uploaded Skill.', {
        statusCode: 500,
        cause: error,
      });
    }
    return this.get(scope, prepared.name);
  }

  /**
   * Builds a read model rooted at the Skills directory of the requested scope.
   *
   * @param scope Global catalog or one Workspace's project Skills.
   * @throws When Workspace scope is requested without a configured Workspace resolver.
   */
  async #resolveStore(scope: SkillScope): Promise<ManagedSkillsStore> {
    if (scope.kind === 'global') {
      return new ManagedSkillsStore(this.#globalRoot);
    }
    if (this.#workspaceService === undefined) {
      throw new ApplicationError(
        'SKILL_WORKSPACE_UNAVAILABLE',
        'Workspace scope requires a Workspace resolver.',
        { statusCode: 500 }
      );
    }
    const workspace = await this.#workspaceService.resolve({ id: scope.workspaceId });
    return new ManagedSkillsStore(join(workspace.cwd, CONFIG_DIR_NAME, 'skills'));
  }

  /**
   * Reports whether a Skill identity is already taken by a loadable Skill or an on-disk directory.
   *
   * @param store Read model scoped to the target Skills root.
   * @param name Validated Skill identity.
   */
  async #exists(store: ManagedSkillsStore, name: string): Promise<boolean> {
    if ((await withManagedSkillsStoreErrors(() => store.scan())).has(name)) {
      return true;
    }
    try {
      await stat(resolveSkillDir(store.root, name));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Builds the stable conflict failure shared by create and upload.
   *
   * @param name Conflicting Skill identity.
   * @param cause Original filesystem failure when available.
   */
  #alreadyExists(name: string, cause?: unknown): ApplicationError {
    return new ApplicationError('SKILL_ALREADY_EXISTS', `A Skill named "${name}" already exists.`, {
      statusCode: 409,
      ...(cause === undefined ? {} : { cause }),
    });
  }

  /**
   * Projects a resolved Skill and its inventory into the public summary shape.
   *
   * @param skill Previously resolved Skill.
   * @param inventory Measured filesystem statistics.
   */
  #toDto(skill: ResolvedPiSkill, inventory: PiSkillInventory): SkillDto {
    return {
      name: skill.name,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
      warnings: skill.warnings,
      fileCount: inventory.fileCount,
      sizeBytes: inventory.sizeBytes,
      updatedAt: inventory.updatedAt,
    };
  }

  /**
   * Projects a resolved Skill into the editing payload consumed by the management UI.
   *
   * @param store Read model scoped to the Skill's root.
   * @param skill Previously resolved Skill.
   */
  async #toDetail(store: ManagedSkillsStore, skill: ResolvedPiSkill): Promise<SkillDetailDto> {
    const inventory = await withManagedSkillsStoreErrors(() => store.statSkill(skill));
    const raw = await withManagedSkillsStoreErrors(() => store.readMarkdown(skill));
    return {
      ...this.#toDto(skill, inventory),
      body: parseFrontmatter(raw).body,
      files: inventory.files,
    };
  }
}
