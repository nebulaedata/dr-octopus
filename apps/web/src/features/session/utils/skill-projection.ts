/**
 * @author Codex
 * @description Identifies persisted Pi skill loads and expanded skill commands without changing transcript data.
 */
import { readString } from './tool-renderer-utils';
import type { ToolProjection } from '@/stores/session';

export interface SkillInvocation {
  name: string;
  path: string;
  instructions: string;
  prompt: string;
}

/**
 * Recognizes canonical skill entry reads; supporting files remain ordinary file reads.
 */
export function projectSkillRead(tool: Pick<ToolProjection, 'name' | 'arguments'>) {
  if (tool.name !== 'read') {
    return undefined;
  }
  const path = readString(tool.arguments, 'path');
  if (!path || /[\r\n\0]/.test(path)) {
    return undefined;
  }
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.at(-1) !== 'SKILL.md' || !parts.includes('skills')) {
    return undefined;
  }
  const name = parts.at(-2);
  if (!name || name === '.' || name === '..' || name === 'skills') {
    return undefined;
  }
  return { name, path };
}

/**
 * Parses the exact user-message envelope persisted by Pi's /skill command expansion.
 */
export function projectSkillCommand(text: string): SkillInvocation | undefined {
  const match = text
    .replace(/\r\n/g, '\n')
    .match(/^<skill name="([^"\n]+)" location="([^"\n]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
  if (!match) {
    return undefined;
  }
  return { name: match[1], path: match[2], instructions: match[3], prompt: match[4] ?? '' };
}
