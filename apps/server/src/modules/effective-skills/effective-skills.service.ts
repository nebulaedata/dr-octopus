/**
 * @author Codex
 * @description Resolves the effective Workspace Skill catalog from a live Pi runtime or a safe public-loader preview.
 */
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  CONFIG_DIR_NAME,
  DefaultResourceLoader,
  SettingsManager,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { responseData } from '../../infrastructure/runtime/index.js';
import type { SessionRuntimeCoordinator, SessionRuntimeBinding } from '../../infrastructure/runtime/index.js';
import type {
  EffectiveSkillCatalogDto,
  EffectiveSkillDto,
  EffectiveSkillOrigin,
  EffectiveSkillScope,
  SkillDiagnosticDto,
} from '@octopus/shared/protocol';
import type { ResourceDiagnostic, Skill, SourceInfo } from '@earendil-works/pi-coding-agent';
import type { WorkspaceService } from '@octopus/agent';

interface RuntimeSkillCommand {
  name: string;
  description?: string;
  source: 'extension' | 'prompt' | 'skill';
  sourceInfo: SourceInfo;
}

export interface EffectiveSkillsServiceOptions {
  workspaceService: Pick<WorkspaceService, 'resolve'>;
  runtime: Pick<SessionRuntimeCoordinator, 'withExisting' | 'getBinding'>;
  agentDir?: string;
}

/**
 * Presents one read-only view of every Skill available in a Workspace context.
 */
export class EffectiveSkillsService {
  readonly #workspaceService: Pick<WorkspaceService, 'resolve'>;
  readonly #runtime: Pick<SessionRuntimeCoordinator, 'withExisting' | 'getBinding'>;
  readonly #agentDir: string;

  /**
   * @param options Workspace authority, runtime authority, and optional deterministic agent directory.
   */
  public constructor(options: EffectiveSkillsServiceOptions) {
    this.#workspaceService = options.workspaceService;
    this.#runtime = options.runtime;
    this.#agentDir = options.agentDir ?? getAgentDir();
  }

  /**
   * Lists effective Skills, preferring an explicitly identified live Runtime when supplied.
   *
   * @param workspaceId Workspace whose cwd defines project resource discovery.
   * @param runtimeId Optional live Runtime identity used for a strongly consistent snapshot.
   */
  public async list(workspaceId: string, runtimeId?: string): Promise<EffectiveSkillCatalogDto> {
    const workspace = await this.#workspaceService.resolve({ id: workspaceId });
    const globalRoot = join(this.#agentDir, 'skills');
    const workspaceRoot = join(workspace.cwd, CONFIG_DIR_NAME, 'skills');
    if (runtimeId !== undefined) {
      const binding = this.#runtime.getBinding(runtimeId);
      this.#assertRuntimeWorkspace(binding, workspaceId);
      return this.#fromRuntime(binding, workspace, globalRoot, workspaceRoot);
    }
    return this.#fromLoader(workspace.cwd, globalRoot, workspaceRoot);
  }

  /**
   * Reads the exact Skill commands already projected by one Pi AgentSession resource loader.
   */
  async #fromRuntime(
    binding: SessionRuntimeBinding,
    workspace: Awaited<ReturnType<WorkspaceService['resolve']>>,
    globalRoot: string,
    workspaceRoot: string
  ): Promise<EffectiveSkillCatalogDto> {
    const response = await this.#runtime.withExisting(
      {
        workspace,
        sessionId: binding.sessionId,
        sessionPath: binding.sessionPath,
        expectedAgentSessionId: binding.agentSessionId,
      },
      async (target) => {
        if (target.binding.runtimeId !== binding.runtimeId || target.binding.epoch !== binding.epoch) {
          throw new ApplicationError(
            'SESSION_RUNTIME_BINDING_MISMATCH',
            'The requested effective Skills Runtime generation is stale.',
            { statusCode: 409 }
          );
        }
        return target.execute({ type: 'get_commands' });
      }
    );
    const data = responseData<{ commands?: RuntimeSkillCommand[] }>(response);
    if (!Array.isArray(data?.commands)) {
      throw new ApplicationError(
        'EFFECTIVE_SKILLS_RUNTIME_INVALID',
        'Pi Runtime returned an invalid Skill catalog.',
        { statusCode: 502 }
      );
    }
    const skills = await Promise.all(
      data.commands
        .filter((command) => command.source === 'skill' && command.name.startsWith('skill:'))
        .map((command) =>
          this.#toEffectiveSkill(
            command.name.slice('skill:'.length),
            command.description ?? '',
            command.sourceInfo,
            globalRoot,
            workspaceRoot
          )
        )
    );
    return this.#catalog('runtime', skills, []);
  }

  /**
   * Resolves a dormant Workspace through Pi's public package and resource loaders without executing extensions.
   */
  async #fromLoader(
    cwd: string,
    globalRoot: string,
    workspaceRoot: string
  ): Promise<EffectiveSkillCatalogDto> {
    const settingsManager = SettingsManager.create(cwd, this.#agentDir);
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: this.#agentDir,
      settingsManager,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const result = loader.getSkills();
    const skills = await Promise.all(
      result.skills.map((skill) => this.#fromLoadedSkill(skill, globalRoot, workspaceRoot))
    );
    return this.#catalog('resolved', skills, result.diagnostics.map(toDiagnosticDto));
  }

  /**
   * Converts one Pi Skill while retaining only stable product-facing source metadata.
   */
  #fromLoadedSkill(skill: Skill, globalRoot: string, workspaceRoot: string): Promise<EffectiveSkillDto> {
    return this.#toEffectiveSkill(skill.name, skill.description, skill.sourceInfo, globalRoot, workspaceRoot);
  }

  /**
   * Computes editability exclusively from server-owned filesystem roots.
   */
  async #toEffectiveSkill(
    name: string,
    description: string,
    sourceInfo: SourceInfo,
    globalRoot: string,
    workspaceRoot: string
  ): Promise<EffectiveSkillDto> {
    let managedScope: 'workspace' | 'global' | undefined;
    if (await isPathOwnedBy(sourceInfo.path, workspaceRoot)) {
      managedScope = 'workspace';
    } else if (await isPathOwnedBy(sourceInfo.path, globalRoot)) {
      managedScope = 'global';
    }
    return {
      name,
      description,
      source: sourceInfo.source,
      scope: normalizeScope(sourceInfo.scope),
      origin: normalizeOrigin(sourceInfo.origin),
      editable: managedScope !== undefined,
      ...(managedScope === undefined ? {} : { managedScope }),
    };
  }

  /**
   * Produces a deterministic generation for cache comparison and diagnostics.
   */
  #catalog(
    consistency: EffectiveSkillCatalogDto['consistency'],
    skills: EffectiveSkillDto[],
    diagnostics: SkillDiagnosticDto[]
  ): EffectiveSkillCatalogDto {
    const sortedSkills = [...skills].sort((left, right) => left.name.localeCompare(right.name));
    const generation = createHash('sha256')
      .update(JSON.stringify({ consistency, skills: sortedSkills, diagnostics }))
      .digest('hex');
    return { consistency, generation, skills: sortedSkills, diagnostics };
  }

  /**
   * Rejects stale or cross-Workspace Runtime identities before any RPC request.
   */
  #assertRuntimeWorkspace(binding: SessionRuntimeBinding, workspaceId: string): void {
    if (binding.workspaceId !== workspaceId) {
      throw new ApplicationError(
        'EFFECTIVE_SKILLS_RUNTIME_MISMATCH',
        'Runtime does not belong to the requested Workspace.',
        { statusCode: 409 }
      );
    }
  }
}

/**
 * Checks lexical and canonical containment so symlinks cannot grant mutation ownership.
 */
async function isPathOwnedBy(filePath: string, root: string): Promise<boolean> {
  if (!isAbsolute(filePath) || !isWithin(filePath, root)) {
    return false;
  }
  const [canonicalFile, canonicalRoot] = await Promise.all([canonicalize(filePath), canonicalize(root)]);
  return isWithin(canonicalFile, canonicalRoot);
}

/**
 * Canonicalizes an existing path and safely falls back for a not-yet-created managed root.
 */
async function canonicalize(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Tests whether a path is the root itself or one of its descendants.
 */
function isWithin(path: string, root: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

/**
 * Narrows future Pi source scopes to the current stable HTTP contract.
 */
function normalizeScope(scope: SourceInfo['scope']): EffectiveSkillScope {
  return scope === 'project' || scope === 'temporary' ? scope : 'user';
}

/**
 * Narrows future Pi origins to the current stable HTTP contract.
 */
function normalizeOrigin(origin: SourceInfo['origin']): EffectiveSkillOrigin {
  return origin === 'package' ? 'package' : 'top-level';
}

/**
 * Removes local paths from public diagnostics while preserving collision identity.
 */
function toDiagnosticDto(diagnostic: ResourceDiagnostic): SkillDiagnosticDto {
  return {
    type: diagnostic.type,
    message: diagnostic.message,
    ...(diagnostic.collision?.name === undefined ? {} : { skillName: diagnostic.collision.name }),
  };
}
