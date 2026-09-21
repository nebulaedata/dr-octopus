/**
 * @author Codex
 * @description Defines managed and effective Skill catalog protocol contracts.
 */

export interface SkillDto {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  fileCount: number;
  sizeBytes: number;
  updatedAt: string;
  /** Validation warnings reported by the Pi Skill loader; empty when the Skill is fully valid. */
  warnings: string[];
}

export interface SkillFileDto {
  /** Slash-separated path relative to the Skill directory. */
  path: string;
  sizeBytes: number;
}

export interface SkillCatalogDto {
  /** Absolute Skills directory backing this scope, shown so users can locate the files. */
  root: string;
  skills: SkillDto[];
}

export interface SkillDetailDto extends SkillDto {
  /** Markdown instructions of SKILL.md with the frontmatter block removed. */
  body: string;
  files: SkillFileDto[];
}

export type EffectiveSkillConsistency = 'runtime' | 'resolved';
export type EffectiveSkillScope = 'user' | 'project' | 'temporary';
export type EffectiveSkillOrigin = 'top-level' | 'package';

export interface EffectiveSkillDto {
  name: string;
  description: string;
  source: string;
  scope: EffectiveSkillScope;
  origin: EffectiveSkillOrigin;
  editable: boolean;
  managedScope?: 'global' | 'workspace';
}

export interface SkillDiagnosticDto {
  type: 'warning' | 'error' | 'collision';
  message: string;
  skillName?: string;
}

export interface EffectiveSkillCatalogDto {
  consistency: EffectiveSkillConsistency;
  generation: string;
  skills: EffectiveSkillDto[];
  diagnostics: SkillDiagnosticDto[];
}
