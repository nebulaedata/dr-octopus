/**
 * @author Codex
 * @description Binds a dedicated unattended process to a durable grant and publishes Pi-native readiness evidence.
 */
import { UNATTENDED_EVIDENCE } from '../definitions/unattended.js';
import { randomUUID } from 'node:crypto';
import { capability, eligible, createUnattendedToolCatalog } from '../lib/tool-catalog.js';
export { capability } from '../lib/tool-catalog.js';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { checkUnattendedPath } from '../lib/unattended-path.js';
import { openGrantRepository } from '../lib/grant-repository.js';
import { requirePermissionGrant } from '../services/grant-validation.js';
import { PermissionGrantError } from '../definitions/grant.js';
import type { UnattendedDescriptor } from '../definitions/unattended.js';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TaskToolCatalogEntry } from '@octopus/shared/protocol/scheduled-tasks';
import type { GrantRepository } from '../definitions/grant.js';
import type { PermissionModeService, PermissionRequest } from '../services/permission-mode-service.js';

export interface UnattendedGate {
  /**
   * Check the latest grant and current mandatory policy before each tool effect.
   */
  check(request: PermissionRequest, ctx: ExtensionContext, input?: Record<string, unknown>): void;
}

/**
 * Install process-local authorization context before the regular gate; inspection never permits tools.
 */
export function registerUnattendedExecution(
  pi: ExtensionAPI,
  service: PermissionModeService
): UnattendedGate | undefined {
  const raw = process.env.DR_OCTOPUS_PERMISSION_EXECUTION;
  const processRole = process.env.DR_OCTOPUS_PROCESS_ROLE;
  const isTaskProcess = processRole === 'scheduled-task' || processRole === 'task-tool-inspection';
  // 角色只标识进程用途，不授予权限；即使授权上下文漏传，也必须进入无人值守检查并拒绝执行。
  if (!raw && !isTaskProcess) {
    return undefined;
  }
  let descriptor: UnattendedDescriptor | undefined;
  let repository: GrantRepository | undefined;
  let initialized = false;
  let failure: PermissionGrantError | undefined;
  let catalog: TaskToolCatalogEntry[] = [];
  /**
   * Record an authoritative failure before aborting; the runner can recover it through get_entries.
   */
  function fail(
    error: unknown,
    ctx: ExtensionContext,
    details: { requestId?: string; toolName?: string } = {}
  ): never {
    pi.setActiveTools([]);
    if (failure) {
      throw failure;
    }
    const code = error instanceof PermissionGrantError ? error.code : 'SCHEDULE_AUTHORIZATION_UNAVAILABLE';
    const reason =
      error instanceof PermissionGrantError ? error.message : 'Unattended permission context is unavailable.';
    pi.appendEntry(UNATTENDED_EVIDENCE, {
      sessionId: ctx.sessionManager.getSessionId(),
      attemptId: descriptor?.attemptId,
      ready: false,
      tools: [],
      code,
      reason,
      ...details,
    });
    failure = new PermissionGrantError(code, reason);
    throw failure;
  }
  /**
   * Reconcile model-visible tools before execution and before Pi snapshots the next turn.
   * Tool-call checks remain authoritative for arguments and changes during an in-flight request.
   */
  function restrictTools(ctx: ExtensionContext, requireLoaded = true): string[] {
    try {
      if (failure) {
        throw failure;
      }
      if (!initialized || !descriptor || descriptor.inspect || !repository) {
        pi.setActiveTools([]);
        return [];
      }
      const grant = requirePermissionGrant(repository, descriptor, descriptor.ref);
      const policy = service.reloadPolicy(ctx.cwd, ctx.isProjectTrusted());
      if (policy.diagnostics.length) {
        throw new Error('Invalid policy');
      }
      const actual = pi.getAllTools();
      if (
        requireLoaded &&
        grant.tools.some(
          (approved) =>
            !actual.some(
              (tool) =>
                eligible(tool.name) &&
                tool.name === approved.name &&
                capability(tool).identity === approved.identity
            )
        )
      ) {
        throw new PermissionGrantError(
          'SCHEDULE_AUTHORIZATION_STALE',
          'An authorized tool did not load or its definition changed.'
        );
      }
      const names = actual
        .filter(
          (tool) =>
            eligible(tool.name) &&
            !['deny', 'ask'].includes(policy.policy.tools[tool.name] ?? '') &&
            grant.tools.some(
              (approved) => approved.name === tool.name && approved.identity === capability(tool).identity
            )
        )
        .map((tool) => tool.name);
      pi.setActiveTools(names);
      return names;
    } catch (error) {
      return fail(error, ctx);
    }
  }
  pi.on('before_agent_start', (event, ctx) => {
    const names = restrictTools(ctx);
    return {
      systemPrompt:
        event.systemPrompt +
        '\n[Unattended task authorization]\n' +
        'Only these tools are authorized for this task: ' +
        (names.join(', ') || '(none)') +
        '. Use only the currently available tools. Ignore workflow instructions that require unavailable tools; use an authorized alternative or explain the limitation. Never request user input or authorization.',
    };
  });
  pi.on('turn_end', (_event, ctx) => {
    restrictTools(ctx);
  });
  pi.on('session_start', (_event, ctx) => {
    pi.setActiveTools([]);
    initialized = false;
    failure = undefined;
    repository?.close();
    repository = undefined;
    try {
      descriptor = JSON.parse(raw ?? 'null') as UnattendedDescriptor;
      if (
        !descriptor ||
        descriptor.sessionId !== ctx.sessionManager.getSessionId() ||
        descriptor.cwd !== ctx.cwd ||
        !descriptor.attemptId ||
        !descriptor.profileId ||
        typeof descriptor.inspect !== 'boolean'
      ) {
        throw new PermissionGrantError(
          'SCHEDULE_AUTHORIZATION_STALE',
          'Execution context does not match this session.'
        );
      }
      const policy = service.reloadPolicy(ctx.cwd, ctx.isProjectTrusted());
      if (policy.diagnostics.length) {
        throw new Error('Invalid policy');
      }
      catalog = createUnattendedToolCatalog(pi.getAllTools(), policy.policy);
      if (!descriptor.inspect) {
        repository = openGrantRepository(getAgentDir(), true);
        const grant = requirePermissionGrant(repository, descriptor, descriptor.ref);
        if (grant.tools.some((tool) => ['deny', 'ask'].includes(policy.policy.tools[tool.name] ?? ''))) {
          throw new PermissionGrantError(
            'SCHEDULE_PERMISSION_DENIED',
            'Current mandatory policy blocks an authorized tool.'
          );
        }
        if (
          grant.tools.some(
            (tool) =>
              !eligible(tool.name) ||
              catalog.some((actual) => actual.name === tool.name && actual.identity !== tool.identity)
          )
        ) {
          throw new PermissionGrantError(
            'SCHEDULE_AUTHORIZATION_STALE',
            'An authorized tool is missing or its definition changed.'
          );
        }
      }
      initialized = true;
      restrictTools(ctx, false);
      pi.appendEntry(UNATTENDED_EVIDENCE, {
        sessionId: descriptor.sessionId,
        attemptId: descriptor.attemptId,
        ready: true,
        tools: catalog,
      });
    } catch (error) {
      fail(error, ctx);
    }
  });
  pi.on('session_shutdown', () => {
    initialized = false;
    repository?.close();
    repository = undefined;
  });
  return {
    check(request, ctx, input = {}) {
      const requestId = `perm-${randomUUID()}`;
      try {
        if (failure) {
          throw failure;
        }
        if (
          !initialized ||
          !descriptor ||
          descriptor.inspect ||
          !repository ||
          ctx.sessionManager.getSessionId() !== descriptor.sessionId ||
          ctx.cwd !== descriptor.cwd
        ) {
          throw new PermissionGrantError(
            'SCHEDULE_AUTHORIZATION_REQUIRED',
            'Unattended execution is not authorized.'
          );
        }
        if (['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(request.toolName)) {
          checkUnattendedPath(ctx.cwd, input);
        }
        const policy = service.reloadPolicy(ctx.cwd, ctx.isProjectTrusted());
        if (policy.diagnostics.length) {
          throw new Error('Invalid policy');
        }
        const grant = requirePermissionGrant(repository, descriptor, descriptor.ref);
        if (grant.tools.some((tool) => ['deny', 'ask'].includes(policy.policy.tools[tool.name] ?? ''))) {
          throw new PermissionGrantError(
            'SCHEDULE_PERMISSION_DENIED',
            'Current mandatory policy blocks an authorized tool.'
          );
        }
        const current = pi.getAllTools().find((tool) => tool.name === request.toolName);
        const identity = current ? capability(current).identity : '';
        if (
          request.sensitive ||
          request.external ||
          ['deny', 'ask'].includes(policy.policy.tools[request.toolName] ?? '') ||
          !eligible(request.toolName) ||
          !grant.tools.some((tool) => tool.name === request.toolName && tool.identity === identity)
        ) {
          throw new PermissionGrantError(
            'SCHEDULE_PERMISSION_DENIED',
            `Task is not authorized to execute ${request.toolName}.`
          );
        }
      } catch (error) {
        service.writeReviewLog('permission_request.blocked', {
          requestId,
          toolName: request.toolName,
          sessionId: ctx.sessionManager.getSessionId(),
          grantId: descriptor?.ref?.grantId,
          resolution: error instanceof PermissionGrantError ? error.code : 'gate_error',
          decidedBy: { kind: 'system', source: 'scheduler' },
        });
        fail(error, ctx, { requestId, toolName: request.toolName });
      }
    },
  };
}
