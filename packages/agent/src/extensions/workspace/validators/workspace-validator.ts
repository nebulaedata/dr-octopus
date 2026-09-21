/**
 * @author Codex
 * @description 集中 Workspace selector、创建命令与受管路径的纯校验规则
 */
import { isAbsolute, relative } from 'node:path';
import { WorkspaceError } from '../definitions/error.js';
import type { CreateWorkspaceCommand, WorkspaceSelector } from '../definitions/types.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ValidatedCreateWorkspaceCommand {
  name: string;
  slug: string;
}

/**
 * @description 校验 selector 恰好包含一个非空 id 或 slug。
 *
 * @returns selector 使用的字段类型。
 */
export function validateWorkspaceSelector(selector: WorkspaceSelector): 'id' | 'slug' {
  const hasId = typeof selector.id === 'string' && selector.id.length > 0;
  const hasSlug = typeof selector.slug === 'string' && selector.slug.length > 0;
  if (hasId === hasSlug || Object.keys(selector).some((key) => key !== 'id' && key !== 'slug')) {
    throw new WorkspaceError(
      'WORKSPACE_SELECTOR_INVALID',
      'Workspace selector must contain exactly one non-empty id or slug.'
    );
  }
  return hasId ? 'id' : 'slug';
}

/**
 * @description 规范化并校验 Workspace 名称与 CLI slug。
 */
export function validateCreateWorkspaceCommand(
  command: CreateWorkspaceCommand
): ValidatedCreateWorkspaceCommand {
  const name = command.name.trim();
  const slug =
    command.slug?.trim() ??
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  if (name.length === 0 || name.length > 100 || !SLUG_PATTERN.test(slug) || slug === 'general') {
    throw new WorkspaceError('WORKSPACE_CREATE_FAILED', 'Workspace name or slug is invalid.');
  }
  return { name, slug };
}

/**
 * @description 判断 child 的规范路径是否严格位于 parent 内。
 */
export function isWithinManagedRoot(parent: string, child: string): boolean {
  const segment = relative(parent, child);
  return segment.length > 0 && !segment.startsWith('..') && !isAbsolute(segment);
}
