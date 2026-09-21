/**
 * @author Codex
 * @description Interprets declarative tool descriptors into permission requests and bounded session scopes.
 */
import path from 'node:path';
import type { PermissionResolvedConfig } from '@octopus/shared/protocol';
import type { PermissionRequest } from './permission-mode-service.js';

export interface NormalizedToolPermission {
  request: PermissionRequest;
  target?: string;
  command?: string;
  detail: string;
  sessionLabel?: string;
}

/**
 * Normalize arbitrary tool inputs with configured fields; absent scope values never create broad grants.
 */
export function normalizePermissionRequest(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  config: PermissionResolvedConfig,
  boundaryCwd: string = cwd
): NormalizedToolPermission {
  const rule = config.toolRules[toolName];
  const targets = readStrings(input, rule?.pathFields ?? config.requestDefaults.pathFields);
  const commands = readStrings(input, rule?.commandFields ?? config.requestDefaults.commandFields);
  const scope: string[] = [];
  let complete = rule !== undefined;
  if (rule?.sessionApproval) {
    for (const field of rule.sessionApproval.fields) {
      const value = readField(input, field) ?? rule.sessionApproval.fieldDefaults?.[field];
      if (typeof value !== 'string' || value.trim() === '') {
        complete = false;
      } else {
        scope.push(field, value);
      }
    }
    for (const field of rule.sessionApproval.pathParents ?? []) {
      const value = readField(input, field);
      if (typeof value !== 'string' || value.trim() === '') {
        complete = false;
      } else {
        scope.push(field, path.dirname(path.resolve(cwd, value)));
      }
    }
  }
  // Exact commands avoid granting chained commands by a shared prefix.
  for (const command of commands) {
    scope.push('command', command);
  }
  for (const target of targets) {
    scope.push('directory', path.dirname(path.resolve(cwd, target)));
  }
  if (!rule?.sessionApproval && scope.length === 0) {
    complete = false;
  }
  const sessionApprovalKey = complete ? JSON.stringify([cwd, toolName, scope]) : undefined;
  return {
    request: {
      toolName,
      kind: rule?.kind ?? 'custom',
      external: targets.some((target) => isOutsideWorkspace(boundaryCwd, path.resolve(cwd, target))),
      sensitive:
        hasSensitiveInput(input) || targets.some(isSensitivePath) || commands.some(isSensitiveCommand),
      sessionApprovalKey,
    },
    target: targets[0],
    command: commands[0],
    detail: [
      toolName,
      ...targets.map((target) => `Target: ${target}`),
      ...commands.map((command) => `Command: ${command}`),
      ...(rule?.sessionApproval ? [`Scope: ${scope.join(' / ')}`] : []),
    ].join('\n'),
    sessionLabel: complete ? `Yes, allow "${toolName}" (${scope.join(' / ')}) for this session` : undefined,
  };
}

/**
 * Read own properties only; configuration cannot traverse object prototypes.
 */
function readField(input: Record<string, unknown>, field: string): unknown {
  let value: unknown = input;
  for (const part of field.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, part)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * Collect all declared path and command values, including array-valued arguments.
 */
function readStrings(input: Record<string, unknown>, fields: string[]): string[] {
  return fields.flatMap((field) => {
    const value = readField(input, field);
    return (Array.isArray(value) ? value : [value]).filter(
      (item): item is string => typeof item === 'string' && item.length > 0
    );
  });
}

/**
 * Recursively scans conventional tool arguments so nested MCP payloads cannot bypass hard denies.
 *
 * @param input Tool input or nested arguments record.
 * @returns Whether any path or command field crosses a hard safety boundary.
 */
function hasSensitiveInput(input: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      const normalizedKey = key.toLowerCase();
      const pathLike =
        normalizedKey.includes('path') ||
        normalizedKey.includes('file') ||
        normalizedKey.includes('directory') ||
        normalizedKey === 'cwd';
      if (
        (normalizedKey === 'command' && isSensitiveCommand(value)) ||
        (pathLike && isSensitivePath(value))
      ) {
        return true;
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (hasSensitiveInput(value as Record<string, unknown>)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Determines whether a target escapes the trusted workspace root.
 *
 * @param cwd Trusted workspace root.
 * @param target Tool target path.
 * @returns Whether the normalized target is outside the workspace.
 */
function isOutsideWorkspace(cwd: string, target: string): boolean {
  const relative = path.relative(path.resolve(cwd), path.resolve(cwd, target));
  return relative.startsWith('..') || path.isAbsolute(relative);
}

/**
 * Recognizes credential-bearing paths that no mode may bypass.
 *
 * @param target Optional tool target.
 * @returns Whether the target belongs to a hard-denied path class.
 */
function isSensitivePath(target: string | undefined): boolean {
  if (target === undefined) {
    return false;
  }
  const normalized = target.replaceAll('\\', '/').toLowerCase();
  const name = normalized.split('/').at(-1) ?? '';
  return (
    name === '.env' ||
    (name.startsWith('.env.') && name !== '.env.example') ||
    normalized.endsWith('/.ssh') ||
    normalized.startsWith('.ssh/') ||
    normalized.includes('/.ssh/')
  );
}

/**
 * Recognizes shell commands that remain prohibited in every mode.
 *
 * @param command Shell command text.
 * @returns Whether the command crosses a hard safety boundary.
 */
function isSensitiveCommand(command: string): boolean {
  return /(^|\s)sudo(\s|$)/i.test(command) || /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/i.test(command);
}
